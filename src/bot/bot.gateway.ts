export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface SentMessage {
  message_id: number;
}

export const BOT_GATEWAY = Symbol('BOT_GATEWAY');

export interface BotGateway {
  send(userId: number, text: string, buttons: InlineKeyboardButton[]): Promise<SentMessage>;
}
