import { Geist_300Light, Geist_400Regular, Geist_500Medium, useFonts } from "@expo-google-fonts/geist";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useNotificationRouting } from "@/notifications";
import { NightProvider, type, useColors, useDark, useNightClock } from "@/theme";

/**
 * 导航：底部三个标签（今天 / 本周 / 我）在 (tabs) 里。
 * 报电量是从底部弹上来的面板（透明弹层，下面的今天页还看得见）；晚间对账是全屏的一屏一问流程。
 * 复盘、设置、数据、建档是从标签页推进去的普通页面，带返回。
 */
SplashScreen.preventAutoHideAsync().catch(() => {}); // 字体加载完再收起启动画面，不闪白屏

// 网页版：藏掉浏览器默认滚动条（像 App 一样），用键盘时给能点的东西一圈陶土色焦点框
if (Platform.OS === "web" && typeof document !== "undefined") {
  const css = document.createElement("style");
  css.textContent = "*{scrollbar-width:none}*::-webkit-scrollbar{display:none}"
    + "[role=button]:focus-visible,[role=tab]:focus-visible,[role=radio]:focus-visible,[role=checkbox]:focus-visible"
    + "{outline:2px solid var(--focus,#B4573A);outline-offset:2px}";
  document.head.appendChild(css);
}

// 从提醒直接点进 /energy 或 /checkin 时，下面也先垫一层标签页：面板后面看得见今天，关掉能回去
export const unstable_settings = { initialRouteName: "(tabs)" };

export default function RootLayout() {
  useNotificationRouting();
  const night = useNightClock();
  const [fonts, fontError] = useFonts({ Geist_300Light, Geist_400Regular, Geist_500Medium });
  const ready = fonts || !!fontError;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null; // 字体没加载完先不画，免得数字闪一下换字体；加载失败就用系统字体
  return <NightProvider value={night}><Root /></NightProvider>;
}

function Root() {
  const c = useColors();
  const dark = useDark();
  // 网页焦点框跟着日夜换色
  useEffect(() => { if (Platform.OS === "web") document.documentElement.style.setProperty("--focus", c.primary); }, [c.primary]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerShadowVisible: false,
        headerTintColor: c.primary,
        headerTitleStyle: { ...type.label, color: c.text },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: c.bg },
      }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "今天" }} />
        <Stack.Screen name="energy" options={{ headerShown: false, presentation: "transparentModal", animation: "none",
          contentStyle: { backgroundColor: "transparent" }, title: "报电量" }} />
        <Stack.Screen name="checkin" options={{ headerShown: false, presentation: "fullScreenModal",
          animation: "slide_from_bottom", title: "晚间对账" }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, title: "认识一下" }} />
        <Stack.Screen name="consent" options={{ headerShown: false, gestureEnabled: false, title: "隐私说明" }} />
        <Stack.Screen name="review" options={{ headerShown: false, presentation: "fullScreenModal",
          animation: "slide_from_bottom", title: "每周复盘" }} />
        <Stack.Screen name="data" options={{ headerShown: false, title: "我的数据" }} />
        <Stack.Screen name="settings" options={{ headerShown: false, title: "设置" }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
