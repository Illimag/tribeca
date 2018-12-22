"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const StyleHelpers = require("./helpers");
const Models = require("../../common/models");
class MidMarketQuoteStyle {
    constructor() {
        this.Mode = Models.QuotingMode.Mid;
        this.GenerateQuote = (input) => {
            var width = input.params.width;
            var size = input.params.size;
            var bidPx = Math.max(input.fv.price - width, 0);
            var askPx = input.fv.price + width;
            return new StyleHelpers.GeneratedQuote(bidPx, size, askPx, size);
        };
    }
}
exports.MidMarketQuoteStyle = MidMarketQuoteStyle;
//# sourceMappingURL=mid-market.js.map