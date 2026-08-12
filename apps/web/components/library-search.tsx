"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const DEBOUNCE_MS = 300;

/**
 * 文库搜索框：受控输入 + 300ms 防抖，把关键词写回 `?q=`。
 * 其余查询参数（time / tag）原样保留，所以搜索能和时间、主题筛选叠加。
 */
export function LibrarySearch() {
  const t = useTranslations("library");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryParam = searchParams.get("q") ?? "";
  const [value, setValue] = useState(queryParam);

  // URL 侧的变化（前进/后退、清除筛选）回灌到输入框。
  useEffect(() => {
    setValue(queryParam);
  }, [queryParam]);

  useEffect(() => {
    if (value === queryParam) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      const qs = params.toString();
      router.replace(`/library${qs ? `?${qs}` : ""}`, { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, queryParam, searchParams, router]);

  return (
    <div className="relative ml-auto">
      <input
        // 用 text 而非 search，避免 WebKit 原生清除按钮与下面的 ✕ 重复
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchPlaceholder")}
        className="w-56 rounded border border-control bg-white px-2 py-1 pr-6 text-xs placeholder:text-muted focus:border-accent focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label={t("searchClear")}
          title={t("searchClear")}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-muted hover:bg-surface"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
