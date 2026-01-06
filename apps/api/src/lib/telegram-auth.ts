import crypto from "crypto";
import type { TelegramUser } from "@dubdub/shared";

/**
 * Validates Telegram WebApp initData according to official docs:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(
  initData: string,
  botToken: string
): { valid: true; user: TelegramUser } | { valid: false; error: string } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash) {
      return { valid: false, error: "Missing hash" };
    }

    // Remove hash from params and sort alphabetically
    params.delete("hash");
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    // Calculate secret key: HMAC_SHA256(bot_token, "WebAppData")
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    // Calculate expected hash: HMAC_SHA256(secret_key, data_check_string)
    const expectedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (expectedHash !== hash) {
      return { valid: false, error: "Invalid hash" };
    }

    // Check auth_date is not too old (allow 24 hours)
    const authDate = params.get("auth_date");
    if (authDate) {
      const authTimestamp = parseInt(authDate, 10);
      const now = Math.floor(Date.now() / 1000);
      if (now - authTimestamp > 86400) {
        return { valid: false, error: "Auth data expired" };
      }
    }

    // Parse user
    const userParam = params.get("user");
    if (!userParam) {
      return { valid: false, error: "Missing user data" };
    }

    const userData = JSON.parse(userParam);
    const user: TelegramUser = {
      id: String(userData.id),
      firstName: userData.first_name || "User",
      lastName: userData.last_name,
      username: userData.username,
    };

    return { valid: true, user };
  } catch (err) {
    return { valid: false, error: `Parse error: ${err}` };
  }
}

