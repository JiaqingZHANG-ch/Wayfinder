/** 公共组件：页面、卡片、文字、按钮、选项、输入框、提示、图标、列表行。页面只拼这些，不自己写样式数值。 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { ReactNode, useState } from "react";
import { router } from "expo-router";
import { Linking, ScrollView, StyleProp, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { enter, haptic, Pressy } from "@/components/motion";
import { radius, space, type, useColors } from "@/theme";

export const MAX_WIDTH = 560; // 网页上内容不铺满，像一张纸
const TOUCH = 44; // 可点区域至少 44pt（Apple HIG）

export type IconName = keyof typeof Ionicons.glyphMap;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const c = useColors();
  return <Ionicons name={name} size={size} color={color ?? c.text} />;
}

/** 浮在内容上的控制条（标签栏、保存栏）：名字沿用以前的玻璃，现在是平色块 + 卡片底边，和 Card 同一套。 */
export function Glass({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.surface, boxShadow: c.clay }, style]}>{children}</View>;
}

/** 按下沉底：底边收到 0、整体下移 4px（v4 的 :active）。给 Pressy 用，Pressy 自己的缩放要关掉（scaleTo={1}）。 */
function useSink(edge: string | undefined) {
  const [down, setDown] = useState(false);
  return {
    onPressIn: () => setDown(true),
    onPressOut: () => setDown(false),
    sink: { boxShadow: down ? undefined : edge, top: down && edge ? 4 : 0 } as ViewStyle,
  };
}

/**
 * safeTop：页面没有标题栏时让出状态栏的高度。bottom：底下有标签栏时多留的空（另加手机底部的安全区）。
 */
export function Screen({ children, scroll = true, safeTop, bottom = 0, refresh }: {
  children: ReactNode; scroll?: boolean; safeTop?: boolean; bottom?: number; refresh?: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const inner = { padding: space.lg, paddingTop: safeTop ? space.xl : space.lg,
    paddingBottom: space.xxl + bottom + (bottom ? insets.bottom : 0),
    gap: space.lg, maxWidth: MAX_WIDTH, width: "100%" as const, alignSelf: "center" as const };
  return (
    // safeTop：滚动区从状态栏下面开始，状态栏下是实底，滚上去的内容不和时间、信号叠字（v4 的 .scroll{top:44px}）
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: safeTop ? insets.top : 0 }}>
      {scroll ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled" refreshControl={refresh as never}>
          <View style={inner}>{children}</View>
        </ScrollView>
      ) : <View style={inner}>{children}</View>}
    </View>
  );
}

/** 卡片：平色块，不描边；卡片内一道高光 + 4px 实色底边（c.clay）。给 onPress 就整张可点（按下沉底）。i 是入场顺序。 */
export function Card({ children, style, onPress, label, i }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string; i?: number;
}) {
  const c = useColors();
  const { sink, ...press } = useSink(c.clay);
  const look: ViewStyle = { borderRadius: radius.card, padding: space.lg, gap: space.md, backgroundColor: c.surface, boxShadow: c.clay };
  const body = onPress ? (
    <Pressy onPress={onPress} {...press} scaleTo={1} accessibilityRole="button" accessibilityLabel={label} style={[look, style, sink]}>{children}</Pressy>
  ) : (
    <View style={[look, style]}>{children}</View>
  );
  return i === undefined ? body : <Animated.View entering={enter(i)}>{body}</Animated.View>;
}

type TextProps = { children: ReactNode; muted?: boolean; center?: boolean; color?: string; lines?: number };

function make(variant: keyof typeof type, role?: "header") {
  return function T({ children, muted, center, color, lines }: TextProps) {
    const c = useColors();
    return (
      <Text accessibilityRole={role} numberOfLines={lines} style={[type[variant], { color: color ?? (muted ? c.muted : c.text) },
        center && { textAlign: "center" }]}>{children}</Text>
    );
  };
}

export const Display = make("display", "header");
export const Title = make("title", "header");
export const Body = make("body");
export const Label = make("label");
export const Small = make("small");

/** 推进去的页面（设置、数据、复盘……）的页头：左上返回，下面大标题，和三个标签页的开头一个样子。 */
export function Header({ title, sub, onBack }: { title: string; sub?: string; onBack?: () => void }) {
  return (
    <Animated.View entering={enter(0)} style={{ gap: space.md }}>
      <IconButton name="chevron-back" label="返回" onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/")))} />
      <View style={{ gap: 2 }}>
        <Display>{title}</Display>
        {sub && <Small muted>{sub}</Small>}
      </View>
    </Animated.View>
  );
}

/** 整页没拿到数据：图标、一句人话、「再试一次」。原始错误不给用户看。children：再给一个去处（比如「去改设置」）。 */
export function ErrorState({ onRetry, text = "网络好了再试一次。", title = "没连上", children }: {
  onRetry: () => void; text?: string; title?: string; children?: ReactNode;
}) {
  const c = useColors();
  return (
    <View aria-live="polite" style={{ alignItems: "center", gap: space.md, paddingTop: space.xxl }}>
      <Icon name={title === "没连上" ? "cloud-offline-outline" : "calendar-clear-outline"} size={40} color={c.muted} />
      <Title>{title}</Title>
      <Body muted center>{text}</Body>
      <Button label="再试一次" icon="refresh" variant="secondary" onPress={onRetry} />
      {children}
    </View>
  );
}

/** 一块数字瓷砖：小标题、一个数字加单位、一句话。size="big" 用于一页里最重要的那个数。 */
export function Stat({ label, value, unit, sub, size = "stat", style, children, onPress, a11y }: {
  label: string; value?: string | number; unit?: string; sub?: string; size?: "stat" | "big";
  style?: StyleProp<ViewStyle>; children?: ReactNode; onPress?: () => void; a11y?: string;
}) {
  const c = useColors();
  return (
    <Card style={[{ flex: 1, gap: 2 }, style]} onPress={onPress} label={a11y && [a11y, sub].filter(Boolean).join("，")}>
      <Text style={[type.eyebrow, { color: c.muted }]}>{label}</Text>
      {value !== undefined && (
        <Text accessibilityLabel={`${label} ${value}${unit ?? ""}`}>
          <Text style={[type[size], { color: c.text }]}>{value}</Text>
          {unit && <Text style={[type.label, { color: c.muted }]}> {unit}</Text>}
        </Text>
      )}
      {sub && <Text style={[type.small, { color: c.muted }]}>{sub}</Text>}
      {children}
    </Card>
  );
}

/** 小节标题：在卡片上面的一行小字。 */
export function Eyebrow({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text accessibilityRole="header" style={[type.eyebrow, { color: c.muted }]}>{children}</Text>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  // primary：主色黄 + 主色底边；secondary：卡片色 + 卡片底边；quiet：透明底主色字；
  // neutral：透明底灰字（次要入口，不抢主按钮）；quietDanger：透明底红字（删除这类）
  variant?: "primary" | "secondary" | "quiet" | "neutral" | "quietDanger" | "danger";
  disabled?: boolean;
  busyLabel?: string; // 有它就表示正在忙：显示它并且不能再点
  accessibilityHint?: string;
  icon?: IconName;
  hug?: boolean; // 不通栏：按内容宽度居中（首页这种不是单手操作位的地方）
};

export function Button({ label, onPress, variant = "primary", disabled, busyLabel, accessibilityHint, icon, hug }: ButtonProps) {
  const c = useColors();
  const off = disabled || !!busyLabel;
  const flat = variant === "quiet" || variant === "neutral" || variant === "quietDanger";
  // 不能点的实心按钮换成次级面灰字、没有底边，不用半透明
  const bg = off && !flat ? c.surface2
    : { primary: c.primary, secondary: c.surface, quiet: "transparent", neutral: "transparent", quietDanger: "transparent", danger: c.danger }[variant];
  const edge = off || flat ? undefined : variant === "primary" ? c.clayBtn : variant === "secondary" ? c.clay : undefined;
  const { sink, ...press } = useSink(edge);
  const fg = off ? c.muted
    : { primary: c.onPrimary, secondary: c.text, quiet: c.primaryInk, neutral: c.muted, quietDanger: c.danger, danger: c.bg }[variant];
  return (
    <Pressy onPress={onPress} {...press} disabled={off} scaleTo={flat ? 0.97 : 1} fadeTo={flat ? 0.6 : 1} accessibilityRole="button"
      accessibilityLabel={busyLabel ?? label} accessibilityState={{ disabled: off, busy: !!busyLabel }} accessibilityHint={accessibilityHint}
      style={[{ minHeight: TOUCH + 8, borderRadius: radius.btn, backgroundColor: bg, flexDirection: "row", gap: space.sm,
        paddingHorizontal: hug ? space.xxl : space.xl, alignItems: "center", justifyContent: "center", opacity: off && flat ? 0.5 : 1,
        ...(hug && { alignSelf: "center" }) }, sink]}>
      {icon && !busyLabel && <Icon name={icon} size={18} color={fg} />}
      <Text style={[flat ? type.label : type.body, { color: fg, fontWeight: "600" }]}>{busyLabel ?? label}</Text>
    </Pressy>
  );
}

/** 圆形图标按钮（关闭、返回）。 */
export function IconButton({ name, label, onPress, color }: { name: IconName; label: string; onPress: () => void; color?: string }) {
  const c = useColors();
  return (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.9}
      style={{ width: TOUCH, height: TOUCH, borderRadius: radius.pill, backgroundColor: c.sunken,
        alignItems: "center", justifyContent: "center" }}>
      <Icon name={name} size={20} color={color ?? c.text} />
    </Pressy>
  );
}

/** 一个可选的小块：平色块 + 底边；选中换浅主色底、主色底边（底边色 vs 底 ≥ 3:1，不只靠底色）。role：单选 radio，多选 / 开关 checkbox。 */
export function Chip({ label, on, onPress, role = "radio" }: {
  label: string; on: boolean; onPress: () => void; role?: "radio" | "checkbox";
}) {
  const c = useColors();
  const { sink, ...press } = useSink(`0 4px 0 ${on ? c.primaryEdge : c.cardEdge}`);
  return (
    <Pressy onPress={() => { haptic.select(); onPress(); }} {...press} accessibilityRole={role} accessibilityLabel={label}
      accessibilityState={{ checked: on }} scaleTo={1}
      style={[{ minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.btn, flexDirection: "row",
        alignItems: "center", gap: space.xs, backgroundColor: on ? c.tint : c.surface }, sink]}>
      {/* 单选不加勾（加了会变宽、整排跳）；多选给勾留固定位置 */}
      {role === "checkbox" && <Icon name="checkmark" size={16} color={on ? c.onSoft : "transparent"} />}
      <Text style={[type.label, { color: on ? c.onSoft : c.text }]}>{label}</Text>
    </Pressy>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "flex-end" }}>{children}</View>;
}

/** 设置式的一行：左边平色图标块，中间标题和说明，右边箭头。放在 Card 里（厚度归卡片），多行之间有分隔线，按下淡一点。 */
export function ListRow({ icon, title, sub, onPress, last }: {
  icon: IconName; title: string; sub?: string; onPress: () => void; last?: boolean;
}) {
  const c = useColors();
  return (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${title}，${sub}` : title} scaleTo={1} fadeTo={0.8}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingVertical: space.sm,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line }}>
      <View style={{ width: 36, height: 36, borderRadius: radius.in, backgroundColor: c.surface2,
        alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={c.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: c.text }]}>{title}</Text>
        {sub && <Text style={[type.small, { color: c.muted }]}>{sub}</Text>}
      </View>
      <Icon name="chevron-forward" size={18} color={c.muted} />
    </Pressy>
  );
}

/** 带标题的输入框；error 显示在下面。获得焦点时边框变成主色底边色（网页上替掉浏览器默认的描边）。 */
export function Field({ label, error, style, ...input }: TextInputProps & { label?: string; error?: string }) {
  const c = useColors();
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: space.xs }, style]}>
      {label && <Text style={[type.small, { color: c.muted }]}>{label}</Text>}
      <TextInput accessibilityLabel={label ?? input.placeholder} placeholderTextColor={c.muted} {...input}
        onFocus={(e) => { setFocus(true); input.onFocus?.(e); }} onBlur={(e) => { setFocus(false); input.onBlur?.(e); }}
        style={[type.body, { minHeight: TOUCH + 4, backgroundColor: c.surface2, color: c.text, borderRadius: radius.in,
          paddingHorizontal: space.lg, paddingVertical: space.md, borderWidth: 1.5,
          outlineWidth: 0, borderColor: error ? c.danger : focus ? c.primaryEdge : "transparent" }, input.multiline && { minHeight: 96, textAlignVertical: "top" }]} />
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
/** 危机提示：一段平静的话，里面的热线号码各给一个能直接拨的按钮（号码来自后端核实过的那段话）。 */
export function CrisisCard({ message }: { message: string }) {
  const c = useColors();
  const numbers = [...new Set(message.match(/(?<=拨打? ?)\d{3,5}|(?<=或 ?)\d{3}/g) ?? [])];
  return (
    <Card>
      <Icon name="heart" size={22} color={c.primaryEdge} />
      <Body>{message}</Body>
      {numbers.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {numbers.map((n) => (
            <Pressy key={n} onPress={() => { Linking.openURL(`tel:${n}`).catch(() => {}); }} accessibilityRole="link"
              accessibilityLabel={`拨打 ${n}`} scaleTo={0.94}
              style={{ minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.pill, flexDirection: "row",
                alignItems: "center", gap: space.xs, backgroundColor: c.soft }}>
              <Icon name="call-outline" size={16} color={c.onSoft} />
              <Text style={[type.label, type.num, { color: c.onSoft }]}>{n}</Text>
            </Pressy>
          ))}
        </View>
      )}
    </Card>
  );
}

/** 读数据时的占位。 */
export function Loading({ text, safeTop }: { text: string; safeTop?: boolean }) {
  return <Screen scroll={false} safeTop={safeTop}><Body muted center>{text}</Body></Screen>;
}
