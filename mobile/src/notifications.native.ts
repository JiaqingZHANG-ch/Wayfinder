// 手机上的两条本地提醒（下课问电量、晚上对账）。时间和文案都由后端 GET /today 给，这里只负责定时和点开跳页。
// 网页版用同名的 notifications.ts（什么都不做）：Metro 按平台自动挑文件。
import * as Notifications from "expo-notifications";
import { Href, router } from "expo-router";
import { useEffect } from "react";

import type { Reminder } from "@/api";

// App 开着的时候到点也弹出来
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

/** 把今天和往后几天还没到点的提醒重新定一遍；没给通知权限就返回 false。 */
export async function scheduleReminders(reminders: (Reminder & { day: string })[]): Promise<boolean> {
  let { granted } = await Notifications.getPermissionsAsync();
  if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  await Notifications.cancelAllScheduledNotificationsAsync(); // 只有这里在定提醒，全清再定最简单
  const now = Date.now();
  for (const r of reminders) {
    const date = new Date(`${r.day}T${r.at}:00`); // 手机本地时间
    if (date.getTime() <= now) continue;
    await Notifications.scheduleNotificationAsync({
      content: { title: r.title, body: r.body, data: { url: r.url } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
  }
  return true;
}

/** 删了全部数据：手机上排好的提醒也清掉。 */
export async function cancelReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** 点了通知就跳到它带的页面（/energy 或 /checkin）。放在根布局里调用一次。 */
export function useNotificationRouting() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = last?.notification.request.content.data?.url;
    if (typeof url === "string") {
      router.push(url as Href);
      Notifications.clearLastNotificationResponse();
    }
  }, [last]);
}
