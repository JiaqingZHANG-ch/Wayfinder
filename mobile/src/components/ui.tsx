/** 公共组件：页面、卡片、文字、按钮、选项、输入框、提示、图标、列表行。页面只拼这些，不自己写样式数值。 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { ReactNode, useState } from "react";
import { ScrollView, StyleProp, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { enter, haptic, Pressy } from "@/components/motion";
import { radius, space, type, useColors } from "@/theme";

const MAX_WIDTH = 560; // 网页上内容不铺满，像一张纸
const TOUCH = 44; // 可点区域至少 44pt（Apple HIG）

export type IconName = keyof typeof Ionicons.glyphMap;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const c = useColors();
  return <Ionicons name={name} size={size} color={color ?? c.text} />;
}

/** safeTop：页面没有标题栏时让出状态栏的高度。bottom：底下有标签栏时多留的空。 */
export function Screen({ children, scroll = true, safeTop, bottom = 0, refresh }: {
  children: ReactNode; scroll?: boolean; safeTop?: boolean; bottom?: number; refresh?: ReactNode;
}) {
  const c = useColors();
  const top = useSafeAreaInsets().top;
  const inner = { padding: space.lg, paddingTop: safeTop ? top + space.xl : space.lg, paddingBottom: space.xxl + bottom,
    gap: space.lg, maxWidth: MAX_WIDTH, width: "100%" as const, alignSelf: "center" as const };
  return scroll ? (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={inner}
      keyboardShouldPersistTaps="handled" refreshControl={refresh as never}>{children}</ScrollView>
  ) : (
    <View style={{ flex: 1, backgroundColor: c.bg }}><View style={inner}>{children}</View></View>
  );
}

/** 卡片：浅色靠柔和投影，深色靠细边。给 onPress 就整张可点（按下缩一点）。i 是入场顺序。 */
export function Card({ children, style, onPress, label, i }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string; i?: number;
}) {
  const c = useColors();
  const look: ViewStyle = { backgroundColor: c.card, borderRadius: radius.lg, padding: space.lg, gap: space.md,
    borderWidth: 1, borderColor: c.edge, boxShadow: c.shadow };
  const body = onPress ? (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[look, style]}>{children}</Pressy>
  ) : (
    <View style={[look, style]}>{children}</View>
  );
  return i === undefined ? body : <Animated.View entering={enter(i)}>{body}</Animated.View>;
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

/** 小节标题：在卡片上面的一行小字。 */
export function Eyebrow({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text accessibilityRole="header" style={[type.small, { color: c.muted, fontWeight: "600", marginLeft: space.xs }]}>{children}</Text>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  busyLabel?: string; // 有它就表示正在忙：显示它并且不能再点
  accessibilityHint?: string;
  icon?: IconName;
};

export function Button({ label, onPress, variant = "primary", disabled, busyLabel, accessibilityHint, icon }: ButtonProps) {
  const c = useColors();
  const off = disabled || !!busyLabel;
  const bg = { primary: c.primary, secondary: c.soft, quiet: "transparent", danger: c.danger }[variant];
  const fg = { primary: c.onPrimary, secondary: c.onSoft, quiet: c.primary, danger: c.onPrimary }[variant];
  return (
    <Pressy onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={busyLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!busyLabel }} accessibilityHint={accessibilityHint}
      style={{ minHeight: TOUCH + 8, borderRadius: radius.pill, backgroundColor: bg, flexDirection: "row", gap: space.sm,
        paddingHorizontal: space.xl, alignItems: "center", justifyContent: "center", opacity: off ? 0.5 : 1 }}>
      {icon && !busyLabel && <Icon name={icon} size={18} color={fg} />}
      <Text style={[type.label, { color: fg, fontWeight: "600" }]}>{busyLabel ?? label}</Text>
    </Pressy>
  );
}

/** 圆形图标按钮（关闭、返回）。 */
export function IconButton({ name, label, onPress }: { name: IconName; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.9}
      style={{ width: TOUCH, height: TOUCH, borderRadius: radius.pill, backgroundColor: c.sunken,
        alignItems: "center", justifyContent: "center" }}>
      <Icon name={name} size={20} color={c.text} />
    </Pressy>
  );
}

/** 一个可选的圆角小块：选中是柔和的陶土底加一个勾。role：单选用 radio，多选 / 开关用 checkbox。 */
export function Chip({ label, on, onPress, role = "radio" }: {
  label: string; on: boolean; onPress: () => void; role?: "radio" | "checkbox";
}) {
  const c = useColors();
  return (
    <Pressy onPress={() => { haptic.select(); onPress(); }} accessibilityRole={role} accessibilityLabel={label}
      accessibilityState={{ checked: on }} scaleTo={0.94}
      style={{ minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.pill, flexDirection: "row",
        alignItems: "center", gap: space.xs, backgroundColor: on ? c.soft : c.sunken, borderWidth: 1.5,
        borderColor: on ? c.primary : "transparent" }}>
      {on && <Icon name="checkmark" size={16} color={c.onSoft} />}
      <Text style={[type.label, { color: on ? c.onSoft : c.text }]}>{label}</Text>
    </Pressy>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "flex-end" }}>{children}</View>;
}

/** 设置式的一行：左边图标块，中间标题和说明，右边箭头。放在 Card 里，多行之间有分隔线。 */
export function ListRow({ icon, title, sub, onPress, last }: {
  icon: IconName; title: string; sub?: string; onPress: () => void; last?: boolean;
}) {
  const c = useColors();
  return (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${title}，${sub}` : title} scaleTo={0.98}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingVertical: space.sm,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line }}>
      <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.soft,
        alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={c.onSoft} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: c.text }]}>{title}</Text>
        {sub && <Text style={[type.small, { color: c.muted }]}>{sub}</Text>}
      </View>
      <Icon name="chevron-forward" size={18} color={c.muted} />
    </Pressy>
  );
}

/** 带标题的输入框；error 显示在下面。获得焦点时边框变成陶土色（网页上替掉浏览器默认的描边）。 */
export function Field({ label, error, style, ...input }: TextInputProps & { label?: string; error?: string }) {
  const c = useColors();
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: space.xs }, style]}>
      {label && <Text style={[type.small, { color: c.muted }]}>{label}</Text>}
      <TextInput accessibilityLabel={label ?? input.placeholder} placeholderTextColor={c.muted} {...input}
        onFocus={(e) => { setFocus(true); input.onFocus?.(e); }} onBlur={(e) => { setFocus(false); input.onBlur?.(e); }}
        style={[type.body, { minHeight: TOUCH + 4, backgroundColor: c.sunken, color: c.text, borderRadius: radius.md,
          paddingHorizontal: space.lg, paddingVertical: space.md, borderWidth: 1.5,
          outlineWidth: 0, borderColor: error ? c.danger : focus ? c.primary : "transparent" }, input.multiline && { minHeight: 96, textAlignVertical: "top" }]} />
      {error && <Text style={[type.small, { color: c.danger }]}>{error}</Text>}
    </View>
  );
}

/** 一行提示：error 用红字加图标，其余用柔和底。aria-live 让网页和安卓的读屏会播报。 */
export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" }) {
  const c = useColors();
  const err = tone === "error";
  return (
    <View aria-live="polite" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start",
      backgroundColor: err ? "transparent" : c.soft, borderRadius: radius.md, padding: err ? 0 : space.md }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={err ? "alert-circle" : "information-circle"} size={16} color={err ? c.danger : c.onSoft} />
      </View>
      <Text style={[type.small, { flex: 1, color: err ? c.danger : c.onSoft }]}>{children}</Text>
    </View>
  );
}

/** 危机提示：用平静的卡片，不用红色。文字由后端按国家给出（热线）。 */
export function CrisisCard({ message }: { message: string }) {
  const c = useColors();
  return (
    <Card>
      <Icon name="heart" size={22} color={c.primary} />
      <Body>{message}</Body>
    </Card>
  );
}

/** 读数据时的占位。 */
export function Loading({ text, safeTop }: { text: string; safeTop?: boolean }) {
  return <Screen scroll={false} safeTop={safeTop}><Body muted center>{text}</Body></Screen>;
}
