"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const server_1 = require("@apollo/server");
const aws_lambda_1 = require("@as-integrations/aws-lambda");
const VERITRANS_ENDPOINT = 'https://api3.veritrans.co.jp/4gtoken';
// GraphQL スキーマ定義
const typeDefs = `#graphql
  # 入力型: カード情報
  input CardInput {
    cardNumber: String!
    cardExpire: String!
    securityCode: String
    cardholderName: String
  }

  # 出力型: トークンレスポンス
  type TokenResponse {
    token: String
    status: String
    code: String
    message: String
  }

  # エラー型
  type TokenError {
    message: String!
    veritransCode: String
    veritransMessage: String
  }

  # Union型: 成功 or エラー
  union TokenResult = TokenResponse | TokenError

  type Query {
    # ヘルスチェック用
    health: String
  }

  type Mutation {
    # MDKトークンを取得
    getMdkToken(card: CardInput!): TokenResponse!
  }
`;
// Veritrans API を呼び出す関数
async function fetchVeritransToken(card) {
    const payload = {
        card_number: card.cardNumber,
        card_expire: card.cardExpire,
        security_code: card.securityCode,
        cardholder_name: card.cardholderName,
        token_api_key: process.env.VERITRANS_TOKEN_API_KEY,
        lang: 'ja',
    };
    const response = await fetch(VERITRANS_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.message || 'Error from Veritrans');
    }
    return result;
}
// リゾルバー定義
const resolvers = {
    Query: {
        health: () => 'OK',
    },
    Mutation: {
        getMdkToken: async (_, { card }) => {
            try {
                const result = await fetchVeritransToken(card);
                return {
                    token: result.token,
                    status: result.status,
                    code: result.code,
                    message: result.message,
                };
            }
            catch (error) {
                console.error('Veritrans error:', error);
                throw error;
            }
        },
    },
};
// Apollo Server インスタンス作成
const server = new server_1.ApolloServer({
    typeDefs,
    resolvers,
});
// Lambda ハンドラーをエクスポート
exports.handler = (0, aws_lambda_1.startServerAndCreateLambdaHandler)(server, aws_lambda_1.handlers.createAPIGatewayProxyEventV2RequestHandler());
