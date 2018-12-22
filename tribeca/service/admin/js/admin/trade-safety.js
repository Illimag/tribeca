"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const angular = require("angular");
const Messaging = require("../common/messaging");
var TradeSafetyController = ($scope, $log, subscriberFactory) => {
    var updateValue = (value) => {
        if (value == null)
            return;
        $scope.tradeSafetyValue = value.combined;
        $scope.buySafety = value.buy;
        $scope.sellSafety = value.sell;
    };
    var clear = () => {
        $scope.tradeSafetyValue = null;
        $scope.buySafety = null;
        $scope.sellSafety = null;
    };
    var subscriber = subscriberFactory.getSubscriber($scope, Messaging.Topics.TradeSafetyValue)
        .registerConnectHandler(clear)
        .registerSubscriber(updateValue, us => us.forEach(updateValue));
    $scope.$on('$destroy', () => {
        subscriber.disconnect();
        $log.info("destroy trade safety");
    });
    $log.info("started trade safety");
};
exports.tradeSafetyDirective = "tradeSafetyDirective";
angular
    .module(exports.tradeSafetyDirective, ['sharedDirectives'])
    .directive("tradeSafety", () => {
    var template = '<span>BuyTS: {{ buySafety|number:2 }}, SellTS: {{ sellSafety|number:2 }}, TotalTS: {{ tradeSafetyValue|number:2 }}</span>';
    return {
        restrict: 'E',
        replace: true,
        transclude: false,
        template: template,
        controller: TradeSafetyController
    };
});
//# sourceMappingURL=trade-safety.js.map