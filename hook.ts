import { useState, useEffect, useRef } from "react";

// 原图比例（4095 / 2894）
const IMG_RATIO = 1.415;

export function useAutoImageHeight(imageUrl: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ height: 690, top: -235, left: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateLayout = (containerWidth: number) => {
      // 1. 根据宽度选择/插值配置档位
      let targetHeight, targetTop, targetFocusX;

      if (containerWidth <= 335) {
        targetHeight = 690;
        targetTop = -235;
        targetFocusX = 0.35;
      } else if (containerWidth >= 1120) {
        targetHeight = 946;
        targetTop = -357;
        targetFocusX = 0.55;
      } else {
        const t = (containerWidth - 335) / (1120 - 335);
        targetHeight = 690 + t * (946 - 690);
        targetTop = -235 + t * (-357 - -235);
        targetFocusX = 0.35 + t * (0.55 - 0.35);
      }

      // 2. 宽度扩大的防露白逻辑（根据你的需求，每次增加100或者直接算出刚好铺满）
      // 如果当前高度下的图片，无法覆盖两边（即使以 focusX 为焦点），则需要增加高度
      // 简单起见，直接计算出刚好能覆盖容器的最小高度
      const minRequiredHeight = Math.max(
        (containerWidth * 0.5) / (IMG_RATIO * targetFocusX),
        (containerWidth * 0.5) / (IMG_RATIO * (1 - targetFocusX)),
      );

      if (minRequiredHeight > targetHeight) {
        // 按步长增加，或者直接精准贴合
        // 这里直接精准贴合，保证平滑过渡（按你的100步长会卡顿）
        targetHeight = minRequiredHeight;

        // 高度突变后，重新计算 Top (保持人物位置相对不变，假设人物在图片垂直 34% 处)
        const focusYRatio = 0.34;
        targetTop = -targetHeight * focusYRatio;
      }

      // 3. 计算 Left
      const currentImgWidth = targetHeight * IMG_RATIO;
      const targetLeft = containerWidth / 2 - currentImgWidth * targetFocusX;

      setLayout({
        height: Math.floor(targetHeight),
        top: Math.floor(targetTop),
        left: Math.floor(targetLeft),
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
  }, [imageUrl]);

  return { containerRef, ...layout };
}
