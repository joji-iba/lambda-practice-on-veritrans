import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createHash } from "crypto";

// テスト環境エンドポイント
const VERITRANS_MPI_ENDPOINT =
  "https://api3.veritrans.co.jp/test-paynow/v2/Authorize/mpi";

/**
 * authHash を生成する
 * authHash = SHA256(merchantCcid + minify(params) + merchantKey)
 */
const generateAuthHash = (
  merchantCcid: string,
  params: Record<string, unknown>,
  merchantKey: string
): string => {
  // params を最小化（minify）
  const minifyParams = JSON.stringify(params);
  // 連結して SHA256 ハッシュを生成
  const joinedString = merchantCcid + minifyParams + merchantKey;
  return createHash("sha256").update(joinedString, "utf8").digest("hex");
};

/**
 * 一意のオーダーIDを生成
 */
const generateOrderId = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `order_${timestamp}_${random}`;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // 環境変数から認証情報を取得
    const merchantCcid = process.env.VERITRANS_MERCHANT_CCID;
    const merchantKey = process.env.VERITRANS_MERCHANT_KEY;

    if (!merchantCcid || !merchantKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Server configuration error: Missing merchant credentials",
        }),
      };
    }

    // ① クライアントから受け取るパラメータ
    const body = JSON.parse(event.body ?? "{}");

    // 必須パラメータのバリデーション
    if (!body.token) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Missing required parameter: token",
        }),
      };
    }

    if (!body.amount) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Missing required parameter: amount",
        }),
      };
    }

    // ② Veritrans MPI Authorize リクエストパラメータを構築
    const orderId = body.orderId || generateOrderId();

    const params: Record<string, unknown> = {
      // 必須パラメータ
      serviceOptionType: body.serviceOptionType || "mpi-complete", // 3DS認証+与信を一括で行う
      orderId: orderId,
      amount: String(body.amount),
      jpo: body.jpo || "10", // 一括払い
      withCapture: body.withCapture || "false", // 与信のみ（売上は別途）

      // MDKトークンを使用する場合
      payNowIdParam: {
        token: body.token,
      },

      // 3DS2.0 関連パラメータ
      redirectionUri: body.redirectionUri || process.env.REDIRECT_URI, // 3DS認証後のリダイレクト先
      verifyResultLink: body.verifyResultLink || "1", // 認証結果リンクを返却
      deviceChannel: body.deviceChannel || "02", // 02: ブラウザ

      // オプション: カード保有者情報（3DS2.0では推奨）
      ...(body.cardholderName && { cardholderName: body.cardholderName }),
      ...(body.cardholderEmail && { cardholderEmail: body.cardholderEmail }),

      // オプション: 請求先住所
      ...(body.billingAddressCity && {
        billingAddressCity: body.billingAddressCity,
      }),
      ...(body.billingAddressCountry && {
        billingAddressCountry: body.billingAddressCountry,
      }),
      ...(body.billingAddressLine1 && {
        billingAddressLine1: body.billingAddressLine1,
      }),
      ...(body.billingPostalCode && {
        billingPostalCode: body.billingPostalCode,
      }),

      // オプション: 配送先住所
      ...(body.shippingAddressCity && {
        shippingAddressCity: body.shippingAddressCity,
      }),
      ...(body.shippingAddressCountry && {
        shippingAddressCountry: body.shippingAddressCountry,
      }),
      ...(body.shippingAddressLine1 && {
        shippingAddressLine1: body.shippingAddressLine1,
      }),
      ...(body.shippingPostalCode && {
        shippingPostalCode: body.shippingPostalCode,
      }),

      // オプション: 顧客IPアドレス
      ...(body.customerIp && { customerIp: body.customerIp }),

      // Push通知URL（決済完了時にVeritransから通知を受け取る）
      ...(body.pushUrl && { pushUrl: body.pushUrl }),

      // バージョン情報
      txnVersion: "2.0.0",

      // テスト環境用（本番では削除）
      ...(process.env.DUMMY_REQUEST === "1" && { dummyRequest: "1" }),

      // マーチャントCCID
      merchantCcid: merchantCcid,
    };

    // ③ authHash を生成
    const authHash = generateAuthHash(merchantCcid, params, merchantKey);

    // ④ リクエストボディを構築
    const requestBody = {
      params: params,
      authHash: authHash,
    };

    console.log(
      "MPI Authorize Request:",
      JSON.stringify({
        orderId: orderId,
        amount: body.amount,
        serviceOptionType: params.serviceOptionType,
      })
    );

    // ⑤ Veritrans MPI Authorize API にリクエスト
    const response = await fetch(VERITRANS_MPI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();

    console.log(
      "MPI Authorize Response:",
      JSON.stringify({
        mstatus: result.result?.mstatus,
        vResultCode: result.result?.vResultCode,
        orderId: result.result?.orderId,
      })
    );

    // ⑥ エラーハンドリング
    if (!response.ok || result.result?.mstatus === "failure") {
      return {
        statusCode: response.ok ? 400 : response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: result.result?.merrMsg || "Error from Veritrans MPI",
          mstatus: result.result?.mstatus,
          vResultCode: result.result?.vResultCode,
          orderId: orderId,
        }),
      };
    }

    // ⑦ 成功レスポンス
    // 3DS認証が必要な場合は authStartUrl や resResponseContents が返される
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // 基本情報
        orderId: result.result?.orderId,
        mstatus: result.result?.mstatus,
        vResultCode: result.result?.vResultCode,
        message: result.result?.merrMsg,

        // 3DS認証関連
        authStartUrl: result.result?.authStartUrl, // 3DS認証開始URL
        resResponseContents: result.result?.resResponseContents, // HTMLコンテンツ（iframeで表示）

        // 3DS2.0 情報
        res3dMessageVersion: result.result?.res3dMessageVersion,
        resCorporationId: result.result?.resCorporationId,
        resBrandId: result.result?.resBrandId,

        // トランザクション情報
        marchTxn: result.result?.marchTxn,
        custTxn: result.result?.custTxn,
      }),
    };
  } catch (error) {
    console.error("MPI Authorize error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Internal Server Error",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
