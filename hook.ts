import { useState, useEffect, useRef } from "react";

interface UseResponsiveBannerOptions {
  originalWidth: number; // 原图宽 (4095)
  originalHeight: number; // 原图高 (2894)
  minHeight?: number; // 最小高度限制
}

// 定义设计稿的两个锚点
const POINT_MOBILE = { width: 335, height: 690, top: -235 };
const POINT_DESKTOP = { width: 1120, height: 946, top: -357 };

export const useResponsiveBanner = ({
  originalWidth,
  originalHeight,
  minHeight = 200,
}: UseResponsiveBannerOptions) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({
    height: 0,
    top: 0,
  });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateLayout = (containerWidth: number) => {
      let targetHeight = 0;
      let targetTop = 0;

      // 1. 根据屏幕宽度，选择计算策略
      if (containerWidth <= POINT_MOBILE.width) {
        // 极小屏：小于等于 335px，直接用小屏数据
        targetHeight = POINT_MOBILE.height;
        targetTop = POINT_MOBILE.top;
      } else if (containerWidth >= POINT_DESKTOP.width) {
        // 大屏：大于等于 1120px，直接用大屏数据
        targetHeight = POINT_DESKTOP.height;
        targetTop = POINT_DESKTOP.top;
      } else {
        // 中间区域：335px ~ 1120px 之间，使用线性插值
        const t =
          (containerWidth - POINT_MOBILE.width) / (POINT_DESKTOP.width - POINT_MOBILE.width);

        // 计算高度和 Top
        targetHeight = POINT_MOBILE.height + t * (POINT_DESKTOP.height - POINT_MOBILE.height);
        targetTop = POINT_MOBILE.top + t * (POINT_DESKTOP.top - POINT_MOBILE.top);
      }

      // 2. 应用最小高度限制（防止特殊小屏导致异常）
      if (targetHeight < minHeight) {
        targetHeight = minHeight;
      }

      setLayout({
        height: Math.floor(targetHeight),
        top: Math.floor(targetTop),
      });
    };

    updateLayout(element.offsetWidth);

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        updateLayout(entry.contentRect.width);
      }
    });
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [originalWidth, originalHeight, minHeight]);

  return { containerRef, ...layout };
};
