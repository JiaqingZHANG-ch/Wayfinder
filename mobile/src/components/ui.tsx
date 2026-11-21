/** 公共组件：页面、卡片、文字、按钮、选项、输入框、提示、图标、列表行。页面只拼这些，不自己写样式数值。 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { ReactNode, useState } from "react";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Linking, Platform, ScrollView, StyleProp, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sky } from "@/components/art";
import { enter, haptic, Pressy } from "@/components/motion";
import { radius, space, type, useColors, useDark } from "@/theme";

const MAX_WIDTH = 560; // 网页上内容不铺满，像一张纸
const TOUCH = 44; // 可点区域至少 44pt（Apple HIG）

export type IconName = keyof typeof Ionicons.glyphMap;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const c = useColors();
  return <Ionicons name={name} size={size} color={color ?? c.text} />;
}

// iOS 26 起用系统的液态玻璃；其余（老 iOS、安卓、网页）用半透明底加发丝边，网页再加背景模糊
const liquid = Platform.OS === "ios" && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

/** 玻璃只给控制层用：底部标签栏、底部面板。内容卡片不用。 */
export function Glass({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const dark = useDark(); // 夜里强制深色时系统可能还是浅色，玻璃要跟着 App 走
  if (liquid) return <GlassView glassEffectStyle="regular" colorScheme={dark ? "dark" : "light"} style={[{ overflow: "hidden" }, style]}>{children}</GlassView>;
  return (
    <View style={[{ backgroundColor: c.glass, borderWidth: 1, borderColor: c.glassEdge, boxShadow: c.glassShadow },
      Platform.OS === "web" && ({ backdropFilter: "blur(22px) saturate(160%)" } as ViewStyle), style]}>{children}</View>
  );
}

/**
 * safeTop：页面没有标题栏时让出状态栏的高度。bottom：底下有标签栏时多留的空（另加手机底部的安全区）。
 * sky：给了「这一天的第几分钟」就在页面背后画那个时段的天色（三个标签页用）。
 */
export function Screen({ children, scroll = true, safeTop, bottom = 0, refresh, sky }: {
  children: ReactNode; scroll?: boolean; safeTop?: boolean; bottom?: number; refresh?: ReactNode; sky?: number;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const inner = { padding: space.lg, paddingTop: safeTop ? insets.top + space.xl : space.lg,
    paddingBottom: space.xxl + bottom + (bottom ? insets.bottom : 0),
    gap: space.lg, maxWidth: MAX_WIDTH, width: "100%" as const, alignSelf: "center" as const };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        // 天色画在滚动内容里：跟着内容滚走，卡片后面是干净的底
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled" refreshControl={refresh as never}>
          {sky !== undefined && <Sky min={sky} />}
          <View style={inner}>{children}</View>
        </ScrollView>
      ) : <>{sky !== undefined && <Sky min={sky} />}<View style={inner}>{children}</View></>}
    </View>
  );
}

/** 卡片：不描边，微透的底加顶边一道高光（浅色再加柔和投影）。给 onPress 就整张可点（按下缩一点）。i 是入场顺序。 */
export function Card({ children, style, onPress, label, i }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string; i?: number;
}) {
  const c = useColors();
  const look: ViewStyle = { borderRadius: radius.lg, padding: space.lg, gap: space.md, boxShadow: c.shadow, overflow: "hidden" };
  // 表面是一层自上而下极淡的渐变，不是平涂
  const face = <LinearGradient colors={c.surfaceGrad} style={{ position: "absolute", inset: 0 }} pointerEvents="none" />;
  const body = onPress ? (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[look, style]}>{face}{children}</Pressy>
  ) : (
    <View style={[look, style]}>{face}{children}</View>
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
  // quiet：透明底陶土字；neutral：透明底灰字（次要入口，不抢主按钮）；quietDanger：透明底红字（删除这类）
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
  // 不能点的实心按钮换成凹陷底灰字，不用半透明（深色里半透明的陶土色发脏）
  const bg = off && !flat ? c.sunken
    : { primary: c.primary, secondary: c.soft, quiet: "transparent", neutral: "transparent", quietDanger: "transparent", danger: c.danger }[variant];
  const lit = variant === "primary" && !off; // 主按钮：两段渐变、顶边高光、同色投影
  const fg = off ? c.muted
    : { primary: c.onPrimary, secondary: c.onSoft, quiet: c.primary, neutral: c.muted, quietDanger: c.danger, danger: c.onPrimary }[variant];
  return (
    <Pressy onPress={onPress} disabled={off} fadeTo={flat ? 0.6 : 1} accessibilityRole="button" accessibilityLabel={busyLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!busyLabel }} accessibilityHint={accessibilityHint}
      style={{ minHeight: TOUCH + 8, borderRadius: radius.pill, backgroundColor: bg, flexDirection: "row", gap: space.sm,
        paddingHorizontal: hug ? space.xxl : space.xl, alignItems: "center", justifyContent: "center", opacity: off && flat ? 0.5 : 1,
        ...(hug && { alignSelf: "center" }), ...(lit && { overflow: "hidden", boxShadow: c.primaryShadow }) }}>
      {lit && <LinearGradient colors={c.primaryGrad} style={{ position: "absolute", inset: 0 }} pointerEvents="none" />}
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
      {/* 单选不加勾（加了会变宽、整排跳）；多选给勾留固定位置 */}
      {role === "checkbox" && <Icon name="checkmark" size={16} color={on ? c.onSoft : "transparent"} />}
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
      <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.sunken,
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
/** 危机提示：一段平静的话，里面的热线号码各给一个能直接拨的按钮（号码来自后端核实过的那段话）。 */
export function CrisisCard({ message }: { message: string }) {
  const c = useColors();
  const numbers = [...new Set(message.match(/(?<=拨打? ?)\d{3,5}|(?<=或 ?)\d{3}/g) ?? [])];
  return (
    <Card>
      <Icon name="heart" size={22} color={c.primary} />
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
