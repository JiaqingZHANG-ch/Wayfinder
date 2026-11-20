/** 公共组件：页面、卡片、文字、按钮、选项、输入框、提示。页面只拼这些，不自己写样式数值。 */
import { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, StyleProp, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";

import { radius, space, type, useColors } from "@/theme";

const MAX_WIDTH = 560; // 网页上内容不铺满，像一张纸
const TOUCH = 44; // 可点区域至少 44pt（Apple HIG）

/** safeTop：页面没有标题栏时（首页）让出状态栏的高度。 */
export function Screen({ children, scroll = true, safeTop }: { children: ReactNode; scroll?: boolean; safeTop?: boolean }) {
  const c = useColors();
  const top = useSafeAreaInsets().top;
  const inner = { padding: space.lg, paddingTop: safeTop ? top + space.xxl : space.lg, paddingBottom: space.xxl, gap: space.lg, maxWidth: MAX_WIDTH,
    width: "100%" as const, alignSelf: "center" as const };
  return scroll ? (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={inner}
      keyboardShouldPersistTaps="handled">{children}</ScrollView>
  ) : (
    <View style={{ flex: 1, backgroundColor: c.bg }}><View style={inner}>{children}</View></View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ backgroundColor: c.card, borderRadius: radius.lg, padding: space.lg, gap: space.md,
      borderWidth: 1, borderColor: c.line }, style]}>{children}</View>
  );
}

type TextProps = { children: ReactNode; muted?: boolean; center?: boolean; color?: string };

function make(variant: keyof typeof type, role?: "header") {
  return function T({ children, muted, center, color }: TextProps) {
    const c = useColors();
    return (
      <Text accessibilityRole={role} style={[type[variant], { color: color ?? (muted ? c.muted : c.text) },
        center && { textAlign: "center" }]}>{children}</Text>
    );
  };
}

export const Display = make("display", "header");
export const Title = make("title", "header");
export const Body = make("body");
export const Label = make("label");
export const Small = make("small");

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  busyLabel?: string; // 有它就表示正在忙：显示它并且不能再点
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = "primary", disabled, busyLabel, accessibilityHint }: ButtonProps) {
  const c = useColors();
  const off = disabled || !!busyLabel;
  const bg = { primary: c.primary, secondary: c.soft, quiet: "transparent", danger: c.danger }[variant];
  const fg = { primary: c.onPrimary, secondary: c.onSoft, quiet: c.primary, danger: c.onPrimary }[variant];
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={busyLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!busyLabel }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [{ minHeight: TOUCH + 4, borderRadius: radius.pill, backgroundColor: bg,
        paddingHorizontal: space.xl, alignItems: "center", justifyContent: "center",
        opacity: off ? 0.5 : pressed ? 0.8 : 1 }]}>
      <Text style={[type.label, { color: fg }]}>{busyLabel ?? label}</Text>
    </Pressable>
  );
}

/** 一个可选的圆角小块：选中是柔和的陶土底。role：单选用 radio，多选 / 开关用 checkbox。 */
export function Chip({ label, on, onPress, role = "radio" }: {
  label: string; on: boolean; onPress: () => void; role?: "radio" | "checkbox";
}) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ checked: on }}
      style={({ pressed }) => [{ minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.pill,
        justifyContent: "center", backgroundColor: on ? c.soft : c.sunken, borderWidth: 1.5,
        borderColor: on ? c.primary : "transparent", opacity: pressed ? 0.8 : 1 }]}>
      <Text style={[type.label, { color: on ? c.onSoft : c.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "flex-end" }}>{children}</View>;
}

/** 带标题的输入框；error 显示在下面。 */
export function Field({ label, error, style, ...input }: TextInputProps & { label?: string; error?: string }) {
  const c = useColors();
  return (
    <View style={[{ gap: space.xs }, style]}>
      {label && <Text style={[type.small, { color: c.muted }]}>{label}</Text>}
      <TextInput accessibilityLabel={label ?? input.placeholder} placeholderTextColor={c.muted} {...input}
        style={[type.body, { minHeight: TOUCH + 4, backgroundColor: c.sunken, color: c.text, borderRadius: radius.md,
          paddingHorizontal: space.lg, paddingVertical: space.md, borderWidth: 1.5,
          borderColor: error ? c.danger : "transparent" }, input.multiline && { minHeight: 88, textAlignVertical: "top" }]} />
      {error && <Text style={[type.small, { color: c.danger }]}>{error}</Text>}
    </View>
  );
}

/** 一行提示：error 用红，其余用柔和底。 */
export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" }) {
  const c = useColors();
  return (
    <View aria-live="polite" style={{ backgroundColor: tone === "error" ? "transparent" : c.soft,
      borderRadius: radius.md, padding: tone === "error" ? 0 : space.md }}>
      <Text style={[type.small, { color: tone === "error" ? c.danger : c.onSoft }]}>{children}</Text>
    </View>
  );
}

/** 危机提示：用平静的卡片，不用红色。文字由后端按国家给出（热线）。 */
export function CrisisCard({ message }: { message: string }) {
  return <Card><Body>{message}</Body></Card>;
}

/** 读数据时的占位。 */
export function Loading({ text, safeTop }: { text: string; safeTop?: boolean }) {
  return <Screen scroll={false} safeTop={safeTop}><Body muted center>{text}</Body></Screen>;
}
