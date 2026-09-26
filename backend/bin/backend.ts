#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { Sess3MailerStack } from '../lib/sess3mailer-stack';

const app = new cdk.App();

new Sess3MailerStack(app, 'Sess3MailerStack', {
  /*
   * デプロイ先のAWSアカウント/リージョンを指定する場合は以下を設定
   * env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
   */
});
