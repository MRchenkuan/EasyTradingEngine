const font_style = 'Monaco, Menlo, Consolas, monospace';

export function paintLine(ctx, [x1, y1, v1], [x2, y2, v2], color, collisionAvoidance) {
  const vertical_offset = 10;

  ctx.setLineDash([5, 3]);
  // 绘制竖线
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();

  // 绘制圆点
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x1, y1, 2, 0, Math.PI * 2);
  ctx.arc(x2, y2, 2, 0, Math.PI * 2);
  ctx.fill();

  // 绘制差值文本
  ctx.fillStyle = color;
  ctx.font = 'bold 12px ' + font_style;

  const v_arr1 = v1.split('/').reverse();
  const v_w_arr1 = v_arr1.map(v => ctx.measureText(v).width);
  const max_v_w1 = Math.max(...v_w_arr1);

  const v_arr2 = v2.split('/');
  const v_w_arr2 = v_arr2.map(v => ctx.measureText(v).width);
  const max_v_w2 = Math.max(...v_w_arr2);

  // 防止重叠，转换坐标
  ({ x: x1, y: y1 } = collisionAvoidance(
    x1 - max_v_w1 / 2,
    y1 - 15 - v_arr1.length * 15,
    max_v_w1,
    v_arr1.length * 15
  ));
  ({ x: x2, y: y2 } = collisionAvoidance(
    x2 - max_v_w2 / 2,
    y2 - 15 + v_arr2.length * 15,
    max_v_w2,
    v_arr2.length * 15
  ));

  // ctx.beginPath();
  // ctx.rect(x1,y1,max_v_w1, v_arr1.length*15)
  // ctx.rect(x2,y2,max_v_w2, v_arr2.length*15)
  // ctx.stroke();

  // 绘制上边沿
  v_arr1.map((v, i) => {
    ctx.fillText(v, x1 + (max_v_w1 - v_w_arr1[i]) / 2, y1 + i * 15 + vertical_offset);
  }); // 绘制下边沿
  v_arr2.map((v, i) => {
    ctx.fillText(v, x2 + (max_v_w2 - v_w_arr2[i]) / 2, y2 + i * 15 + vertical_offset);
  });

  // 重置虚线样式（恢复为实线）
  ctx.setLineDash([]);
}

export function simpAssetName(name) {
  return name.split('-')[0];
}

export function createCollisionAvoidance() {
  const placed = []; // 存储已放置的标签信息

  // 检测两个矩形是否重叠
  function checkOverlap(rect1, rect2) {
    return (
      rect1.x < rect2.x + rect2.w &&
      rect1.x + rect1.w > rect2.x &&
      rect1.y < rect2.y + rect2.h &&
      rect1.y + rect1.h > rect2.y
    );
  }

  // 计算排斥力方向
  function calculateForce(current, target) {
    const dx = current.x + current.w / 2 - (target.x + target.w / 2);
    const dy = current.y + current.h / 2 - (target.y + target.h / 2);
    const distance = Math.sqrt(dx * dx + dy * dy) || 1; // 避免除零
    return { dx: dx / distance, dy: dy / distance };
  }

  return (x, y, w, h) => {
    let current = { x, y, w, h };
    const maxIterations = 100; // 最大迭代次数
    const forceFactor = 0.2; // 力反馈系数
    let iterations = 0;

    while (iterations++ < maxIterations) {
      let totalDx = 0;
      let totalDy = 0;
      let hasCollision = false;

      // 检查与所有已放置标签的碰撞
      for (const placedLabel of placed) {
        if (!checkOverlap(current, placedLabel)) continue;

        hasCollision = true;
        // 计算重叠区域
        const overlapX =
          Math.min(current.x + w, placedLabel.x + placedLabel.w) -
          Math.max(current.x, placedLabel.x);
        const overlapY =
          Math.min(current.y + h, placedLabel.y + placedLabel.h) -
          Math.max(current.y, placedLabel.y);

        // 计算排斥力方向
        const { dx, dy } = calculateForce(current, placedLabel);

        // 根据重叠量计算力度
        const force = Math.sqrt(overlapX * overlapX + overlapY * overlapY);
        totalDx += dx * force * forceFactor;
        totalDy += dy * force * forceFactor;
      }

      // 无碰撞时退出循环
      if (!hasCollision) break;

      // 应用力反馈调整位置
      current.x += totalDx;
      current.y += totalDy;
    }

    // 记录最终位置
    placed.push({ ...current });
    return { x: current.x, y: current.y };
  };
}
