"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const angular = require("angular");
const Messaging = require("../common/messaging");
var TargetBasePositionController = ($scope, $log, subscriberFactory) => {
    var update = (value) => {
        if (value == null)
            return;
        $scope.targetBasePosition = value.data;
    };
    var subscriber = subscriberFactory.getSubscriber($scope, Messaging.Topics.TargetBasePosition)
        .registerConnectHandler(() => $scope.targetBasePosition = null)
        .registerSubscriber(update, us => us.forEach(update));
    $scope.$on('$destroy', () => {
        subscriber.disconnect();
        $log.info("destroy target base position");
    });
    $log.info("started target base position");
};
exports.targetBasePositionDirective = "targetBasePositionDirective";
angular
    .module(exports.targetBasePositionDirective, ['sharedDirectives'])
    .directive("targetBasePosition", () => {
    var template = '<span>{{ targetBasePosition|number:2 }}</span>';
    return {
        restrict: 'E',
        replace: true,
        transclude: false,
        template: template,
        controller: TargetBasePositionController
    };
});
//# sourceMappingURL=target-base-position.js.map