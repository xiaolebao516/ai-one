import { useEffect, useState } from 'react';
import { armDevDeliberationFault, clearDevDeliberationFault, isDevDeliberationFaultArmed } from './deliberationFault';

export function DevDeliberationFaultControl({ disabled }: { disabled: boolean }) {
  const [armed, setArmed] = useState(isDevDeliberationFaultArmed);
  useEffect(() => { if (!disabled) setArmed(isDevDeliberationFaultArmed()); }, [disabled]);
  if (!import.meta.env.DEV) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={armed}
        className="rounded border border-amber-500 px-2 py-1 text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-900"
        onClick={() => {
          if (armed) { clearDevDeliberationFault(); setArmed(false); }
          else setArmed(armDevDeliberationFault());
        }}
      >
        {armed ? '已准备模拟错误（点击取消）' : '测试：模拟 Gemini 第一轮报错'}
      </button>
      <span className="text-amber-800 dark:text-amber-200">
        仅开发版；发送 Gemini 第一轮消息前模拟一次失败，点击 Retry 后才实际发送。
      </span>
    </div>
  );
}
