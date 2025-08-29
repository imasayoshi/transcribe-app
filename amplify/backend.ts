import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { PolicyDocument, PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { Policy } from "aws-cdk-lib/aws-iam";

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
});

// ユーザープールのパスワードポリシーを設定
const { cfnUserPool } = backend.auth.resources.cfnResources;
if (cfnUserPool) {
  cfnUserPool.usernameAttributes = [];
  cfnUserPool.policies = {
    passwordPolicy: {
      minimumLength: 6, // 最小文字数
      requireLowercase: false, // 小文字を必要とするか
      requireNumbers: false, // 数字を必要とするか
      requireSymbols: false, // 記号を必要とするか
      requireUppercase: false, // 大文字を必要とするか
      temporaryPasswordValidityDays: 30, // 仮パスワードの有効期間
    },
  };
}

// AWS Transcribe Streamingへのアクセス権限を追加
backend.auth.resources.authenticatedUserIamRole.attachInlinePolicy(
  new Policy(
    backend.auth.resources.authenticatedUserIamRole.stack,
    "TranscribeStreamingPolicy",
    {
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              "transcribe:StartStreamTranscription",
              "transcribe:StartStreamTranscriptionWebSocket",
            ],
            resources: ["*"],
          }),
        ],
      }),
    }
  )
);
