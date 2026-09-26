import * as path from 'path';
import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface Sess3MailerStackProps extends cdk.StackProps {
  /**
   * SESがメールを保存するS3バケット名。未指定時は検証用バケットを新規作成します。
   */
  sesMailBucketName?: string;
  /**
   * SESメールが格納されているプレフィックス（フォルダ）。例: "emails/"
   */
  sesMailPrefix?: string;
  /**
   * SESメールS3バケットのリージョン（例: "us-east-1"）。未指定時は自動解決
   */
  sesMailBucketRegion?: string;
  /**
   * CloudFront署名付きクッキー用の公開鍵PEMファイルのパス
   */
  publicKeyPath?: string;
  /**
   * カスタムドメイン名（例: email.uji52.com）
   */
  customDomainName?: string;
  /**
   * ACM証明書ARN（※CloudFront用のため必ず us-east-1 で発行された証明書）
   */
  certificateArn?: string;
}

export class Sess3MailerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: Sess3MailerStackProps) {
    super(scope, id, props);

    // 1. パラメータの取得 (Props または cdk.json の context から取得)
    const sesMailBucketName =
      props?.sesMailBucketName ||
      this.node.tryGetContext('sesMailBucketName') ||
      process.env.SES_BUCKET_NAME;

    const sesMailPrefix =
      props?.sesMailPrefix ||
      this.node.tryGetContext('sesMailPrefix') ||
      '';

    const sesMailBucketRegion =
      props?.sesMailBucketRegion ||
      this.node.tryGetContext('sesMailBucketRegion') ||
      '';

    const publicKeyPathProp =
      props?.publicKeyPath ||
      this.node.tryGetContext('publicKeyPath') ||
      '../keys/public_key.pem';

    const customDomainName =
      props?.customDomainName ||
      this.node.tryGetContext('customDomainName');

    const certificateArn =
      props?.certificateArn ||
      this.node.tryGetContext('certificateArn');

    let certificate: acm.ICertificate | undefined;
    let domainNames: string[] | undefined;

    if (customDomainName && certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(this, 'CustomDomainCert', certificateArn);
      domainNames = [customDomainName];
    }

    // 2. SES受信メール用S3バケットの特定
    let sesMailBucket: s3.IBucket;
    if (sesMailBucketName && sesMailBucketName !== 'YOUR_SES_BUCKET_NAME') {
      sesMailBucket = s3.Bucket.fromBucketName(this, 'SesMailBucket', sesMailBucketName);
    } else {
      // バケット名が未指定の場合は検証用新規バケットを作成
      sesMailBucket = new s3.Bucket(this, 'SesMailBucket', {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
    }

    // 3. フロントエンド静的Webサイト用S3バケット
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 4. CloudFront PublicKey & KeyGroup の作成（署名付きCookie保護用）
    const resolvedKeyPath = path.isAbsolute(publicKeyPathProp)
      ? publicKeyPathProp
      : path.resolve(__dirname, '..', publicKeyPathProp);

    if (!fs.existsSync(resolvedKeyPath)) {
      throw new Error(
        `CloudFront公開鍵ファイルが見つかりません: ${resolvedKeyPath}\n先に \`./tools/generate_keys.sh\` を実行して鍵ペアを生成してください。`
      );
    }

    const publicKeyPem = fs.readFileSync(resolvedKeyPath, 'utf8');
    const publicKey = new cloudfront.PublicKey(this, 'MailViewerPublicKey', {
      encodedKey: publicKeyPem,
      comment: 'Key for SES Mail Viewer signed cookies',
    });

    const keyGroup = new cloudfront.KeyGroup(this, 'MailViewerKeyGroup', {
      items: [publicKey],
      comment: 'Key group for SES Mail Viewer',
    });

    // 5. メール一覧・詳細・添付ファイル取得 API用 Lambda 関数
    const emailApiFunction = new lambdaNodejs.NodejsFunction(this, 'EmailApiFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/email-api/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        SES_BUCKET_NAME: sesMailBucket.bucketName,
        SES_PREFIX: sesMailPrefix,
        SES_BUCKET_REGION: sesMailBucketRegion,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // S3読み取り権限の付与
    sesMailBucket.grantRead(emailApiFunction);

    // 6. API Gateway (HTTP API)
    const httpApi = new apigwv2.HttpApi(this, 'EmailHttpApi', {
      description: 'SES Mail Viewer Backend API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['*'],
      },
    });

    const lambdaIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      'EmailApiIntegration',
      emailApiFunction
    );

    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.OPTIONS],
      integration: lambdaIntegration,
    });

    // 7. CloudFront Distribution
    // API Gateway のホスト名を取得
    const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint));
    const apiOrigin = new cloudfrontOrigins.HttpOrigin(apiDomain);

    const distribution = new cloudfront.Distribution(this, 'MailViewerDistribution', {
      defaultRootObject: 'index.html',
      comment: 'SES S3 Mail Viewer with Signed Cookies Protection',
      domainNames,
      certificate,
      // デフォルト: フロントエンドS3 (OAC + TrustedKeyGroup)
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        trustedKeyGroups: [keyGroup],
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // /api/*: API Gateway (TrustedKeyGroup + Cache無効化)
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          trustedKeyGroups: [keyGroup],
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      },
    });

    // 8. フロントエンド Web アセットの S3 デプロイ & CloudFront キャッシュ無効化
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../front'))],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // 9. デプロイ後の出力
    const siteDomain = customDomainName || distribution.distributionDomainName;

    new cdk.CfnOutput(this, 'MailViewerUrl', {
      value: `https://${siteDomain}`,
      description: 'SES Mail Viewer Web URL',
    });

    new cdk.CfnOutput(this, 'CloudFrontPublicKeyId', {
      value: publicKey.publicKeyId,
      description: 'CloudFront Public Key ID for Signed Cookies',
    });

    new cdk.CfnOutput(this, 'CloudFrontKeyGroupId', {
      value: keyGroup.keyGroupId,
      description: 'CloudFront Key Group ID',
    });

    new cdk.CfnOutput(this, 'GenerateCookieCommand', {
      value: `node tools/generate_cloudfront_signed_cookies.js --publicKeyId ${publicKey.publicKeyId} --domain ${siteDomain}`,
      description: 'Command to generate signed cookies for browser access',
    });
  }
}
