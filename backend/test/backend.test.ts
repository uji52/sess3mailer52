import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Sess3MailerStack } from '../lib/sess3mailer-stack';

test('Sess3MailerStack synthesizes correctly with required resources', () => {
  const app = new cdk.App();
  const stack = new Sess3MailerStack(app, 'TestStack', {
    publicKeyPath: '../keys/public_key.pem',
  });

  const template = Template.fromStack(stack);

  // CloudFront Distribution が作成されていること
  template.resourceCountIs('AWS::CloudFront::Distribution', 1);

  // CloudFront PublicKey & KeyGroup が作成されていること
  template.resourceCountIs('AWS::CloudFront::PublicKey', 1);
  template.resourceCountIs('AWS::CloudFront::KeyGroup', 1);

  // Lambda 関数が作成されていること
  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'index.handler',
    Runtime: 'nodejs22.x',
  });

  // API Gateway HTTP API が作成されていること
  template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
});
