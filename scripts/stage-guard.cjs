// Serverless v3 generates a timestamped deployment logical ID. Apply stage limits
// to that generated resource without relying on a particular timestamp.
module.exports = class StageGuard {
  constructor(serverless) {
    this.hooks = {
      'after:aws:package:finalize:mergeCustomProviderResources': () => {
        const resources = serverless.service.provider.compiledCloudFormationTemplate.Resources;
        for (const resource of Object.values(resources)) {
          if (resource.Type !== 'AWS::ApiGateway::Deployment') continue;
          resource.Properties.StageDescription = {
            ...(resource.Properties.StageDescription || {}),
            DataTraceEnabled: false,
            MethodSettings: [{HttpMethod: '*', ResourcePath: '/*',
              DataTraceEnabled: false, ThrottlingRateLimit: 2, ThrottlingBurstLimit: 5}],
          };
        }
      },
    };
  }
};
