// Update the existing API stage after deployment; StageDescription on a new
// Deployment conflicts with a stage that already exists.
module.exports = class StageGuard {
  constructor(serverless) {
    this.hooks = {
      'after:deploy:finalize': async () => {
        const provider = serverless.getProvider('aws');
        const result = await provider.request('CloudFormation', 'describeStackResource', {
          StackName: provider.naming.getStackName(),
          LogicalResourceId: provider.naming.getRestApiLogicalId(),
        });
        await provider.request('APIGateway', 'updateStage', {
          restApiId: result.StackResourceDetail.PhysicalResourceId,
          stageName: provider.getApiGatewayStage(),
          patchOperations: [
            {op: 'replace', path: '/*/*/logging/dataTrace', value: 'false'},
            {op: 'replace', path: '/*/*/throttling/rateLimit', value: '2'},
            {op: 'replace', path: '/*/*/throttling/burstLimit', value: '5'},
          ],
        });
      },
    };
  }
};
