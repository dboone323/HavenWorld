export interface DragBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class DraggablePanel {
  /**
   * Attaches pointer drag event handlers to an element, clamped to viewport boundaries
   */
  static makeDraggable(
    panel: HTMLElement,
    handle?: HTMLElement,
    getBounds?: () => DragBounds
  ): { destroy: () => void } {
    const dragTarget = handle || panel;
    let isDragging = false;
    let startPointerX = 0;
    let startPointerY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    dragTarget.style.cursor = 'grab';

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      // Don't drag if clicking buttons, inputs or links
      const target = e.target as HTMLElement;
      if (['BUTTON', 'INPUT', 'TEXTAREA', 'A'].includes(target.tagName)) return;

      isDragging = true;
      dragTarget.style.cursor = 'grabbing';

      const point = 'touches' in e ? e.touches[0] : e;
      startPointerX = point.clientX;
      startPointerY = point.clientY;

      const rect = panel.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      panel.style.position = 'fixed';
      panel.style.margin = '0';
      panel.style.left = `${initialLeft}px`;
      panel.style.top = `${initialTop}px`;

      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    };

    const onPointerMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      if ('cancelable' in e && e.cancelable) e.preventDefault();

      const point = 'touches' in e ? e.touches[0] : e;
      const dx = point.clientX - startPointerX;
      const dy = point.clientY - startPointerY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      const bounds = getBounds
        ? getBounds()
        : {
            minX: 0,
            minY: 0,
            maxX: window.innerWidth - panel.offsetWidth,
            maxY: window.innerHeight - panel.offsetHeight,
          };

      newLeft = Math.max(bounds.minX, Math.min(bounds.maxX, newLeft));
      newTop = Math.max(bounds.minY, Math.min(bounds.maxY, newTop));

      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      dragTarget.style.cursor = 'grab';

      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
    };

    dragTarget.addEventListener('mousedown', onPointerDown);
    dragTarget.addEventListener('touchstart', onPointerDown, { passive: true });

    return {
      destroy: () => {
        dragTarget.removeEventListener('mousedown', onPointerDown);
        dragTarget.removeEventListener('touchstart', onPointerDown);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
      },
    };
  }
}
