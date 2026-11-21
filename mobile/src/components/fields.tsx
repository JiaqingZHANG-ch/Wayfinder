import { useState } from "react";

import { Field } from "@/components/ui";

export const HALF = { flex: 1, minWidth: 130 };

export function Num({ label, value, onChange, decimal }: { label: string; value: number; onChange: (v: number) => void; decimal?: boolean }) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {  // 保存后服务器返回的值不一样（比如取整）时，框里跟着变；打字时不打断
    setPrev(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <Field label={label} value={text} keyboardType={decimal ? "decimal-pad" : "number-pad"} style={HALF}
      onChangeText={(t) => {
        setText(t);
        const n = Number(t);
        if (t.trim() && !Number.isNaN(n)) onChange(n);
      }} />
  );
}
