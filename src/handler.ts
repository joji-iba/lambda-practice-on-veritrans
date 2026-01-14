import type { APIGatewayProxyHandler } from 'aws-lambda';

const VERITRANS_ENDPOINT = 'https://api3.veritrans.co.jp/4gtoken';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // ① クライアントから受け取る（例）
    const body = JSON.parse(event.body ?? '{}');

    const payload = {
      card_number: body.card_number,
      card_expire: body.card_expire,
      security_code: body.security_code,
      cardholder_name: body.cardholder_name,
      token_api_key: process.env.VERITRANS_TOKEN_API_KEY,
      lang: 'ja',
    };

    // ② Veritrans に POST
    const response = await fetch(VERITRANS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    // ③ エラーハンドリング
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: response.message || 'Error from Veritrans',
          veritrans: result,
        }),
      };
    }

    // ④ トークンのみ返す（カード情報は返さない）
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: result.token,
        status: result.status,
        code: result.code,
        message: result.message,
      }),
    };

  } catch (error) {
    console.error('Veritrans error', error);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Internal Server Error',
      }),
    };
  }
};
