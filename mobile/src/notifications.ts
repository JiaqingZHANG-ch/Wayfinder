// 网页版：浏览器里不定本地提醒（expo-notifications 只支持 iOS 和安卓）。手机上用的是 notifications.native.ts。
import type { Reminder } from "@/api";

export async function scheduleToday(_day: string, _reminders: Reminder[]): Promise<boolean> {
  return false;
}

export function useNotificationRouting() {}
