"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const angular = require("angular");
const Models = require("../common/models");
const Messaging = require("../common/messaging");
const Shared = require("./shared_directives");
class Level {
}
var MarketQuotingController = ($scope, $log, subscriberFactory, product) => {
    var toPrice = (px) => px.toFixed(product.fixed);
    var toPercent = (askPx, bidPx) => ((askPx - bidPx) / askPx * 100).toFixed(2);
    var clearMarket = () => {
        $scope.levels = [];
    };
    clearMarket();
    var clearBid = () => {
        $scope.qBidPx = null;
        $scope.qBidSz = null;
    };
    var clearAsk = () => {
        $scope.qAskPx = null;
        $scope.qAskSz = null;
    };
    var clearSpread = () => {
        $scope.spreadValue = null;
    };
    var clearQuote = () => {
        clearBid();
        clearAsk();
        clearSpread();
    };
    var clearFairValue = () => {
        $scope.fairValue = null;
    };
    var clearQuoteStatus = () => {
        $scope.bidIsLive = false;
        $scope.askIsLive = false;
    };
    var clearExtVal = () => {
        $scope.extVal = null;
    };
    var updateMarket = (update) => {
        if (update == null) {
            clearMarket();
            return;
        }
        for (var i = 0; i < update.asks.length; i++) {
            if (angular.isUndefined($scope.levels[i]))
                $scope.levels[i] = new Level();
            $scope.levels[i].askPrice = toPrice(update.asks[i].price);
            $scope.levels[i].askSize = update.asks[i].size;
        }
        for (var i = 0; i < update.bids.length; i++) {
            if (angular.isUndefined($scope.levels[i]))
                $scope.levels[i] = new Level();
            $scope.levels[i].bidPrice = toPrice(update.bids[i].price);
            $scope.levels[i].bidSize = update.bids[i].size;
        }
        updateQuoteClass();
    };
    var updateQuote = (quote) => {
        if (quote !== null) {
            if (quote.bid !== null) {
                $scope.qBidPx = toPrice(quote.bid.price);
                $scope.qBidSz = quote.bid.size;
            }
            else {
                clearBid();
            }
            if (quote.ask !== null) {
                $scope.qAskPx = toPrice(quote.ask.price);
                $scope.qAskSz = quote.ask.size;
            }
            else {
                clearAsk();
            }
            if (quote.ask !== null && quote.bid !== null) {
                const spreadAbsolutePrice = (quote.ask.price - quote.bid.price).toFixed(2);
                const spreadPercent = toPercent(quote.ask.price, quote.bid.price);
                $scope.spreadValue = `${spreadAbsolutePrice} / ${spreadPercent}%`;
            }
            else {
                clearFairValue();
            }
        }
        else {
            clearQuote();
        }
        updateQuoteClass();
    };
    var updateQuoteStatus = (status) => {
        if (status == null) {
            clearQuoteStatus();
            return;
        }
        $scope.bidIsLive = (status.bidStatus === Models.QuoteStatus.Live);
        $scope.askIsLive = (status.askStatus === Models.QuoteStatus.Live);
        updateQuoteClass();
    };
    var updateQuoteClass = () => {
        if (!angular.isUndefined($scope.levels) && $scope.levels.length > 0) {
            for (var i = 0; i < $scope.levels.length; i++) {
                var level = $scope.levels[i];
                if ($scope.qBidPx === level.bidPrice && $scope.bidIsLive) {
                    level.bidClass = 'success';
                }
                else {
                    level.bidClass = 'active';
                }
                if ($scope.qAskPx === level.askPrice && $scope.askIsLive) {
                    level.askClass = 'success';
                }
                else {
                    level.askClass = 'active';
                }
            }
        }
    };
    var updateFairValue = (fv) => {
        if (fv == null) {
            clearFairValue();
            return;
        }
        $scope.fairValue = toPrice(fv.price);
    };
    var subscribers = [];
    var makeSubscriber = (topic, updateFn, clearFn) => {
        var sub = subscriberFactory.getSubscriber($scope, topic)
            .registerSubscriber(updateFn, ms => ms.forEach(updateFn))
            .registerConnectHandler(clearFn);
        subscribers.push(sub);
    };
    makeSubscriber(Messaging.Topics.MarketData, updateMarket, clearMarket);
    makeSubscriber(Messaging.Topics.Quote, updateQuote, clearQuote);
    makeSubscriber(Messaging.Topics.QuoteStatus, updateQuoteStatus, clearQuoteStatus);
    makeSubscriber(Messaging.Topics.FairValue, updateFairValue, clearFairValue);
    $scope.$on('$destroy', () => {
        subscribers.forEach(d => d.disconnect());
        $log.info("destroy market quoting grid");
    });
    $log.info("started market quoting grid");
};
exports.marketQuotingDirective = "marketQuotingDirective";
angular
    .module(exports.marketQuotingDirective, ['ui.bootstrap', 'ui.grid', Shared.sharedDirectives])
    .directive("marketQuotingGrid", () => {
    return {
        restrict: 'E',
        replace: true,
        transclude: false,
        templateUrl: "market_display.html",
        controller: MarketQuotingController
    };
});
//# sourceMappingURL=market-quoting.js.map