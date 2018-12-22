"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws = require("ws");
const Q = require("q");
const crypto = require("crypto");
const request = require("request");
const url = require("url");
const querystring = require("querystring");
const NullGateway = require("./nullgw");
const Models = require("../../common/models");
const Utils = require("../utils");
const util = require("util");
const Interfaces = require("../interfaces");
const _ = require("lodash");
const logging_1 = require("../logging");
var shortId = require("shortid");
class OkCoinWebsocket {
    constructor(config) {
        this.send = (channel, parameters, cb) => {
            var subsReq = { event: 'addChannel', channel: channel };
            if (parameters !== null)
                subsReq.parameters = parameters;
            this._ws.send(JSON.stringify(subsReq), (e) => {
                if (!e && cb)
                    cb();
            });
        };
        this.setHandler = (channel, handler) => {
            this._handlers[channel] = handler;
        };
        this.onMessage = (raw) => {
            var t = Utils.date();
            try {
                var msg = JSON.parse(raw)[0];
                if (typeof msg.event !== "undefined" && msg.event == "ping") {
                    this._ws.send(this._serializedHeartbeat);
                    return;
                }
                if (typeof msg.success !== "undefined") {
                    if (msg.success !== "true")
                        this._log.warn("Unsuccessful message", msg);
                    else
                        this._log.info("Successfully connected to %s", msg.channel);
                    return;
                }
                var handler = this._handlers[msg.channel];
                if (typeof handler === "undefined") {
                    this._log.warn("Got message on unknown topic", msg);
                    return;
                }
                handler(new Models.Timestamped(msg.data, t));
            }
            catch (e) {
                this._log.error(e, "Error parsing msg %o", raw);
                throw e;
            }
        };
        this.ConnectChanged = new Utils.Evt();
        this._serializedHeartbeat = JSON.stringify({ event: "pong" });
        this._log = logging_1.default("tribeca:gateway:OkCoinWebsocket");
        this._handlers = {};
        this._ws = new ws(config.GetString("OkCoinWsUrl"));
        this._ws.on("open", () => this.ConnectChanged.trigger(Models.ConnectivityStatus.Connected));
        this._ws.on("message", this.onMessage);
        this._ws.on("close", () => this.ConnectChanged.trigger(Models.ConnectivityStatus.Disconnected));
    }
}
class OkCoinMarketDataGateway {
    constructor(socket, symbolProvider) {
        this.ConnectChanged = new Utils.Evt();
        this.MarketTrade = new Utils.Evt();
        this.onTrade = (trades) => {
            _.forEach(trades.data, trade => {
                var px = parseFloat(trade[1]);
                var amt = parseFloat(trade[2]);
                var side = trade[4] === "ask" ? Models.Side.Ask : Models.Side.Bid;
                var mt = new Models.GatewayMarketTrade(px, amt, trades.time, trades.data.length > 0, side);
                this.MarketTrade.trigger(mt);
            });
        };
        this.MarketData = new Utils.Evt();
        this.Depth = 25;
        this.onDepth = (depth) => {
            var msg = depth.data;
            var bids = _(msg.bids).take(this.Depth).map(OkCoinMarketDataGateway.GetLevel).value();
            var asks = _(msg.asks).reverse().take(this.Depth).map(OkCoinMarketDataGateway.GetLevel).value();
            var mkt = new Models.Market(bids, asks, depth.time);
            this.MarketData.trigger(mkt);
        };
        this._log = logging_1.default("tribeca:gateway:OkCoinMD");
        var depthChannel = "ok_" + symbolProvider.symbolWithoutUnderscore + "_depth";
        var tradesChannel = "ok_" + symbolProvider.symbolWithoutUnderscore + "_trades_v1";
        socket.setHandler(depthChannel, this.onDepth);
        socket.setHandler(tradesChannel, this.onTrade);
        socket.ConnectChanged.on(cs => {
            this.ConnectChanged.trigger(cs);
            if (cs == Models.ConnectivityStatus.Connected) {
                socket.send(depthChannel, {});
                socket.send(tradesChannel, {});
            }
        });
    }
}
OkCoinMarketDataGateway.GetLevel = (n) => new Models.MarketSide(n[0], n[1]);
class OkCoinOrderEntryGateway {
    constructor(_socket, _signer, _symbolProvider) {
        this._socket = _socket;
        this._signer = _signer;
        this._symbolProvider = _symbolProvider;
        this.OrderUpdate = new Utils.Evt();
        this.ConnectChanged = new Utils.Evt();
        this.generateClientOrderId = () => shortId.generate();
        this.supportsCancelAllOpenOrders = () => { return false; };
        this.cancelAllOpenOrders = () => { return Q(0); };
        this.cancelsByClientOrderId = false;
        this._ordersWaitingForAckQueue = [];
        this.sendOrder = (order) => {
            var o = {
                symbol: this._symbolProvider.symbol,
                type: OkCoinOrderEntryGateway.GetOrderType(order.side, order.type),
                price: order.price.toString(),
                amount: order.quantity.toString()
            };
            this._ordersWaitingForAckQueue.push(order.orderId);
            this._socket.send("ok_spotusd_trade", this._signer.signMessage(o), () => {
                this.OrderUpdate.trigger({
                    orderId: order.orderId,
                    computationalLatency: Utils.fastDiff(Utils.date(), order.time)
                });
            });
        };
        this.onOrderAck = (ts) => {
            var orderId = this._ordersWaitingForAckQueue.shift();
            if (typeof orderId === "undefined") {
                this._log.error("got an order ack when there was no order queued!", util.format(ts.data));
                return;
            }
            var osr = { orderId: orderId, time: ts.time };
            if (ts.data.result === "true") {
                osr.exchangeId = ts.data.order_id.toString();
                osr.orderStatus = Models.OrderStatus.Working;
            }
            else {
                osr.orderStatus = Models.OrderStatus.Rejected;
            }
            this.OrderUpdate.trigger(osr);
        };
        this.cancelOrder = (cancel) => {
            var c = { order_id: cancel.exchangeId, symbol: this._symbolProvider.symbol };
            this._socket.send("ok_spotusd_cancel_order", this._signer.signMessage(c), () => {
                this.OrderUpdate.trigger({
                    orderId: cancel.orderId,
                    computationalLatency: Utils.fastDiff(Utils.date(), cancel.time)
                });
            });
        };
        this.onCancel = (ts) => {
            var osr = { exchangeId: ts.data.order_id.toString(), time: ts.time };
            if (ts.data.result === "true") {
                osr.orderStatus = Models.OrderStatus.Cancelled;
            }
            else {
                osr.orderStatus = Models.OrderStatus.Rejected;
                osr.cancelRejected = true;
            }
            this.OrderUpdate.trigger(osr);
        };
        this.replaceOrder = (replace) => {
            this.cancelOrder(replace);
            this.sendOrder(replace);
        };
        this.onTrade = (tsMsg) => {
            var t = tsMsg.time;
            var msg = tsMsg.data;
            var avgPx = parseFloat(msg.averagePrice);
            var lastQty = parseFloat(msg.sigTradeAmount);
            var lastPx = parseFloat(msg.sigTradePrice);
            var status = {
                exchangeId: msg.orderId.toString(),
                orderStatus: OkCoinOrderEntryGateway.getStatus(msg.status),
                time: t,
                lastQuantity: lastQty > 0 ? lastQty : undefined,
                lastPrice: lastPx > 0 ? lastPx : undefined,
                averagePrice: avgPx > 0 ? avgPx : undefined,
                pendingCancel: msg.status === 4,
                partiallyFilled: msg.status === 1
            };
            this.OrderUpdate.trigger(status);
        };
        this._log = logging_1.default("tribeca:gateway:OkCoinOE");
        _socket.setHandler("ok_usd_realtrades", this.onTrade);
        _socket.setHandler("ok_spotusd_trade", this.onOrderAck);
        _socket.setHandler("ok_spotusd_cancel_order", this.onCancel);
        _socket.ConnectChanged.on(cs => {
            this.ConnectChanged.trigger(cs);
            if (cs === Models.ConnectivityStatus.Connected) {
                _socket.send("ok_usd_realtrades", _signer.signMessage({}));
            }
        });
    }
    static GetOrderType(side, type) {
        if (side === Models.Side.Bid) {
            if (type === Models.OrderType.Limit)
                return "buy";
            if (type === Models.OrderType.Market)
                return "buy_market";
        }
        if (side === Models.Side.Ask) {
            if (type === Models.OrderType.Limit)
                return "sell";
            if (type === Models.OrderType.Market)
                return "sell_market";
        }
        throw new Error("unable to convert " + Models.Side[side] + " and " + Models.OrderType[type]);
    }
    static getStatus(status) {
        switch (status) {
            case -1: return Models.OrderStatus.Cancelled;
            case 0: return Models.OrderStatus.Working;
            case 1: return Models.OrderStatus.Working;
            case 2: return Models.OrderStatus.Complete;
            case 4: return Models.OrderStatus.Working;
            default: return Models.OrderStatus.Other;
        }
    }
}
class OkCoinMessageSigner {
    constructor(config) {
        this.signMessage = (m) => {
            var els = [];
            if (!m.hasOwnProperty("api_key"))
                m.api_key = this._api_key;
            var keys = [];
            for (var key in m) {
                if (m.hasOwnProperty(key))
                    keys.push(key);
            }
            keys.sort();
            for (var i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (m.hasOwnProperty(k))
                    els.push(k + "=" + m[k]);
            }
            var sig = els.join("&") + "&secret_key=" + this._secretKey;
            m.sign = crypto.createHash('md5').update(sig).digest("hex").toString().toUpperCase();
            return m;
        };
        this._api_key = config.GetString("OkCoinApiKey");
        this._secretKey = config.GetString("OkCoinSecretKey");
    }
}
class OkCoinHttp {
    constructor(config, _signer) {
        this._signer = _signer;
        this.post = (actionUrl, msg) => {
            var d = Q.defer();
            request({
                url: url.resolve(this._baseUrl, actionUrl),
                body: querystring.stringify(this._signer.signMessage(msg)),
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                method: "POST"
            }, (err, resp, body) => {
                if (err)
                    d.reject(err);
                else {
                    try {
                        var t = Utils.date();
                        var data = JSON.parse(body);
                        d.resolve(new Models.Timestamped(data, t));
                    }
                    catch (e) {
                        this._log.error(err, "url: %s, err: %o, body: %o", actionUrl, err, body);
                        d.reject(e);
                    }
                }
            });
            return d.promise;
        };
        this._log = logging_1.default("tribeca:gateway:OkCoinHTTP");
        this._baseUrl = config.GetString("OkCoinHttpUrl");
    }
}
class OkCoinPositionGateway {
    constructor(_http) {
        this._http = _http;
        this.PositionUpdate = new Utils.Evt();
        this.trigger = () => {
            this._http.post("userinfo.do", {}).then(msg => {
                var free = msg.data.info.funds.free;
                var freezed = msg.data.info.funds.freezed;
                for (var currencyName in free) {
                    if (!free.hasOwnProperty(currencyName))
                        continue;
                    var amount = parseFloat(free[currencyName]);
                    var held = parseFloat(freezed[currencyName]);
                    var pos = new Models.CurrencyPosition(amount, held, OkCoinPositionGateway.convertCurrency(currencyName));
                    this.PositionUpdate.trigger(pos);
                }
            }).done();
        };
        this._log = logging_1.default("tribeca:gateway:OkCoinPG");
        setInterval(this.trigger, 15000);
        setTimeout(this.trigger, 10);
    }
    static convertCurrency(name) {
        switch (name.toLowerCase()) {
            case "usd": return Models.Currency.USD;
            case "ltc": return Models.Currency.LTC;
            case "btc": return Models.Currency.BTC;
            default: throw new Error("Unsupported currency " + name);
        }
    }
}
class OkCoinBaseGateway {
    constructor(minTickIncrement) {
        this.minTickIncrement = minTickIncrement;
    }
    get hasSelfTradePrevention() {
        return false;
    }
    name() {
        return "OkCoin";
    }
    makeFee() {
        return 0.001;
    }
    takeFee() {
        return 0.002;
    }
    exchange() {
        return Models.Exchange.OkCoin;
    }
}
class OkCoinSymbolProvider {
    constructor(pair) {
        const GetCurrencySymbol = (s) => Models.fromCurrency(s);
        this.symbol = GetCurrencySymbol(pair.base) + "_" + GetCurrencySymbol(pair.quote);
        this.symbolWithoutUnderscore = GetCurrencySymbol(pair.base) + GetCurrencySymbol(pair.quote);
    }
}
class OkCoin extends Interfaces.CombinedGateway {
    constructor(config, pair) {
        var symbol = new OkCoinSymbolProvider(pair);
        var signer = new OkCoinMessageSigner(config);
        var http = new OkCoinHttp(config, signer);
        var socket = new OkCoinWebsocket(config);
        var orderGateway = config.GetString("OkCoinOrderDestination") == "OkCoin"
            ? new OkCoinOrderEntryGateway(socket, signer, symbol)
            : new NullGateway.NullOrderGateway();
        super(new OkCoinMarketDataGateway(socket, symbol), orderGateway, new OkCoinPositionGateway(http), new OkCoinBaseGateway(.01));
    }
}
function createOkCoin(config, pair) {
    return __awaiter(this, void 0, void 0, function* () {
        return new OkCoin(config, pair);
    });
}
exports.createOkCoin = createOkCoin;
//# sourceMappingURL=okcoin.js.map