"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type Direction = "left" | "right";
type Status = "ready" | "playing" | "over";
type Move = {
  kind: "climb" | "fall";
  direction: Direction;
  startedAt: number;
  duration: number;
};
type Engine = {
  status: Status;
  score: number;
  best: number;
  time: number;
  history: Direction[];
  stairs: Direction[];
  move: Move | null;
  facing: Direction;
  newRecord: boolean;
  introStartedAt: number;
};
type Hud = Pick<Engine, "status" | "score" | "best" | "time" | "newRecord">;
type Platform = { x: number; y: number; level: number; current: boolean; next: boolean };

const STORAGE_KEY = "admin-stairs-game-high-score";
const WIDTH = 900;
const HEIGHT = 560;
const MAX_TIME = 9000;
const STEP_RISE = 58;
const STEP_RUN = 104;
const MAX_HORIZONTAL_STEPS = 3;
const PLAYER_BASELINE = 410;
const VISIBLE_AHEAD = 12;
const MAX_HISTORY = 5;

function randomDirection(): Direction {
  return Math.random() < 0.5 ? "left" : "right";
}

function nextStair(directions: Direction[]): Direction {
  const position = directions.reduce((sum, direction) => sum + (direction === "right" ? 1 : -1), 0);
  const available = (["left", "right"] as const).filter((direction) => {
    const nextPosition = position + (direction === "right" ? 1 : -1);
    return Math.abs(nextPosition) <= MAX_HORIZONTAL_STEPS;
  });
  return available[Math.floor(Math.random() * available.length)] ?? randomDirection();
}

function createStairs(count: number): Direction[] {
  const stairs: Direction[] = [];
  while (stairs.length < count) stairs.push(nextStair(stairs));
  return stairs;
}

function makeEngine(best = 0): Engine {
  return {
    status: "ready",
    score: 0,
    best,
    time: MAX_TIME,
    history: [],
    stairs: [],
    move: null,
    facing: "right",
    newRecord: false,
    introStartedAt: 0,
  };
}

function makePlatforms(history: Direction[], stairs: Direction[], scroll = 0): Platform[] {
  const positions = [0];
  for (const direction of [...history].reverse()) {
    positions.unshift(positions[0] - (direction === "right" ? 1 : -1));
  }
  for (const direction of stairs) {
    positions.push(positions[positions.length - 1] + (direction === "right" ? 1 : -1));
  }

  const currentLevel = history.length;
  const currentX = positions[currentLevel];
  return positions.map((position, index) => ({
    x: WIDTH / 2 + (position - currentX) * STEP_RUN,
    y: PLAYER_BASELINE - (index - currentLevel) * STEP_RISE + scroll,
    level: index,
    current: index === currentLevel,
    next: index === currentLevel + 1,
  }));
}

function polygon(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
  ctx.closePath();
  ctx.fill();
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = "#fff";
  const unit = 10 * scale;
  [
    [-3, 0, 4, 2],
    [-2, -1, 5, 3],
    [0, -2, 4, 4],
    [3, -1, 4, 3],
    [5, 0, 3, 2],
  ].forEach(([dx, dy, width, height]) => {
    ctx.fillRect(x + dx * unit, y + dy * unit, width * unit, height * unit);
  });
  ctx.restore();
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  offset: number,
  opacity: number,
  variant: number,
) {
  const top = y - offset;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.fillStyle = color;
  ctx.fillRect(x, top, width, height + 40);
  ctx.fillStyle = "rgba(255,255,255,.3)";
  ctx.fillRect(x + 10, top + 11, width - 20, 4);
  const columns = Math.max(1, Math.floor((width - 24) / 25));
  const rows = Math.ceil((height + 10) / 29);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const windowY = top + 28 + row * 29;
      if (windowY < HEIGHT && (row * 7 + column * 3 + variant) % 6 !== 0) {
        ctx.fillStyle = (row + column + variant) % 4 === 0 ? "#fff1b1" : "rgba(255,255,255,.58)";
        ctx.fillRect(x + 12 + column * 25, windowY, 8, 12);
      }
    }
  }

  const roofY = top;
  ctx.fillStyle = "#aa94d0";
  ctx.fillRect(x - 3, roofY - 5, width + 6, 7);
  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.fillRect(x + 2, roofY - 5, Math.max(8, width * 0.35), 2);
  if (variant % 3 === 0) {
    ctx.fillStyle = "#8a75b0";
    ctx.fillRect(x + width * 0.55, roofY - 19, width * 0.2, 14);
    ctx.fillRect(x + width * 0.59, roofY - 25, width * 0.12, 6);
  } else if (variant % 3 === 1) {
    ctx.fillStyle = "#9f87c7";
    ctx.fillRect(x + width * 0.18, roofY - 16, width * 0.22, 11);
    ctx.fillStyle = "#f3e8a9";
    ctx.fillRect(x + width * 0.21, roofY - 12, 4, 3);
  } else {
    ctx.fillStyle = "#79649d";
    ctx.fillRect(x + width * 0.7, roofY - 22, 3, 17);
    ctx.fillRect(x + width * 0.63, roofY - 18, width * 0.17, 2);
    ctx.fillRect(x + width * 0.66, roofY - 25, width * 0.1, 3);
  }
  ctx.restore();
}

function blendColor(from: string, to: string, amount: number) {
  const mix = Math.max(0, Math.min(1, amount));
  const fromRgb = from.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const toRgb = to.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const rgb = fromRgb.map((channel, index) => Math.round(channel + ((toRgb[index] ?? channel) - channel) * mix));
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

function smoothstep(start: number, end: number, value: number) {
  const progress = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return progress * progress * (3 - 2 * progress);
}

function drawBackground(ctx: CanvasRenderingContext2D, now: number, scroll: number) {
  const altitude = scroll / STEP_RISE;
  const cloudLevel = smoothstep(18, 105, altitude);
  const highSky = smoothstep(90, 170, altitude);
  const cityVisibility = 1 - smoothstep(30, 115, altitude);
  const roofVisibility = smoothstep(12, 64, altitude) * (1 - smoothstep(82, 145, altitude));
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, blendColor("#d8c9ff", "#eeeaff", highSky));
  sky.addColorStop(0.55, blendColor("#eee8ff", "#f6f2ff", highSky));
  sky.addColorStop(1, blendColor("#fbf7ff", "#ffffff", highSky));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const sunY = 105 - scroll * 0.012;
  ctx.fillStyle = `rgba(255,249,208,${0.76 - highSky * 0.18})`;
  ctx.beginPath();
  ctx.arc(740, sunY, 38 + highSky * 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${0.28 + highSky * 0.22})`;
  ctx.beginPath();
  ctx.arc(740, sunY, 54 + highSky * 20, 0, Math.PI * 2);
  ctx.fill();

  const cloudDrift = now * 0.009;
  const cloudDepths = [
    { x: 20, y: 65, scale: 0.75, speed: 0.24, period: 520, opacity: 0.32 },
    { x: 222, y: 185, scale: 1.08, speed: 0.12, period: 700, opacity: 0.56 },
    { x: 445, y: 105, scale: 0.58, speed: 0.32, period: 620, opacity: 0.4 },
    { x: 690, y: 248, scale: 1.2, speed: 0.17, period: 760, opacity: 0.52 },
    { x: 835, y: 143, scale: 0.8, speed: 0.28, period: 580, opacity: 0.44 },
    { x: 122, y: 366, scale: 1.3, speed: 0.1, period: 820, opacity: 0.4 },
    { x: 553, y: 394, scale: 0.94, speed: 0.22, period: 660, opacity: 0.48 },
    { x: 825, y: 470, scale: 1.15, speed: 0.14, period: 740, opacity: 0.4 },
  ] as const;

  cloudDepths.forEach((cloud, index) => {
    const phase = (scroll * cloud.speed + index * cloud.period * 0.47) % cloud.period;
    const y = ((cloud.y + phase + cloud.period) % (HEIGHT + 120)) - 60;
    const driftX = Math.sin(now / 1900 + index * 1.7) * 34 + cloudDrift * (index % 2 ? 1 : -0.65);
    const x = ((cloud.x + driftX + 980) % 980) - 40;
    drawCloud(ctx, x, y, cloud.scale, cloud.opacity * (0.22 + cloudLevel * 0.78));
  });

  const nearShift = scroll * 0.28;
  const farRise = Math.max(0, altitude * 2.05);
  const roofRise = Math.max(0, altitude * 1.15);
  const farBuildings = [
    { x: -38, y: 322, width: 136, height: 228, color: "#c4b3e8", variant: 0 },
    { x: 102, y: 281, width: 105, height: 260, color: "#cdbfee", variant: 1 },
    { x: 211, y: 344, width: 157, height: 206, color: "#baa7df", variant: 2 },
    { x: 372, y: 297, width: 120, height: 250, color: "#c8b8ea", variant: 3 },
    { x: 498, y: 336, width: 172, height: 215, color: "#c1b0e7", variant: 4 },
    { x: 675, y: 275, width: 128, height: 270, color: "#d0c2ef", variant: 5 },
    { x: 807, y: 326, width: 142, height: 220, color: "#bda9e2", variant: 6 },
  ] as const;

  farBuildings.forEach((building, index) => {
    const drift = Math.sin(altitude * 0.11 + index * 2.4) * 42;
    const scale = Math.max(0.42, 1 - highSky * 0.58);
    const width = building.width * scale;
    const height = building.height * scale;
    const x = building.x + (building.width - width) / 2;
    const y = building.y + farRise + drift + (building.height - height);
    drawBuilding(
      ctx,
      x,
      y,
      width,
      height,
      building.color,
      -scroll * 0.022,
      cityVisibility * 0.62,
      building.variant,
    );
  });

  const roofLine = 390 + roofRise + Math.sin(nearShift / 70) * 16;
  ctx.save();
  ctx.globalAlpha = roofVisibility * 0.78;
  polygon(ctx, [[0, roofLine + 36], [132, roofLine - 24], [248, roofLine + 28], [382, roofLine - 38], [520, roofLine + 22], [652, roofLine - 28], [780, roofLine + 34], [900, roofLine - 14], [900, HEIGHT + 80], [0, HEIGHT + 80]], "#ac96d6");
  ctx.fillStyle = "#9179bb";
  ctx.fillRect(0, roofLine + 14, WIDTH, 11);
  ctx.fillStyle = "rgba(255,255,255,.58)";
  ctx.fillRect(20, roofLine + 17, WIDTH - 40, 3);
  for (let i = 0; i < 8; i += 1) {
    const unit = (i * 137 + 61) % WIDTH;
    const structureY = roofLine - 4 - ((i * 19) % 27);
    ctx.fillStyle = i % 2 ? "#927bb7" : "#c9b7e8";
    ctx.fillRect(unit, structureY, 28 + (i % 3) * 8, 18 + (i % 2) * 12);
    ctx.fillStyle = "#81709c";
    ctx.fillRect(unit + 5, structureY - 8, 3, 8);
    if (i % 3 === 0) {
      ctx.fillRect(unit + 13, structureY - 13, 2, 13);
      ctx.fillRect(unit + 7, structureY - 10, 12, 2);
    }
  }
  ctx.restore();

  const distantCityAlpha = cityVisibility * (0.16 + cloudLevel * 0.08);
  if (distantCityAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = distantCityAlpha;
    farBuildings.forEach((building, index) => {
      const scale = 0.2 + (index % 3) * 0.035;
      const width = building.width * scale;
      const height = building.height * scale;
      const x = index * 126 - 15;
      drawBuilding(ctx, x, HEIGHT - height + 22, width, height, "#8876ac", 0, 1, building.variant + 2);
    });
    ctx.restore();
  }

  if (cloudLevel > 0.18) {
    const cloudBankAlpha = smoothstep(0.18, 0.72, cloudLevel) * 0.23;
    ctx.save();
    ctx.globalAlpha = cloudBankAlpha;
    drawCloud(ctx, -30 + Math.sin(now / 1300) * 18, 435 + ((scroll * 0.2) % 90), 1.7, 1);
    drawCloud(ctx, 820 + Math.cos(now / 1700) * 25, 325 + ((scroll * 0.16) % 100), 1.45, 1);
    ctx.restore();
  }

  const glow = ctx.createLinearGradient(0, 270, 0, HEIGHT);
  glow.addColorStop(0, "rgba(255,255,255,0)");
  glow.addColorStop(1, `rgba(255,255,255,${0.24 + highSky * 0.4})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 270, WIDTH, HEIGHT - 270);
}

function drawPlatform(ctx: CanvasRenderingContext2D, platform: Platform, shake: number) {
  const x = platform.x + shake;
  const y = platform.y;
  const left = x - STEP_RUN / 2;
  const right = x + STEP_RUN / 2;

  ctx.fillStyle = "rgba(83,57,128,.20)";
  ctx.fillRect(left + 8, y + 40, STEP_RUN, 13);
  polygon(ctx, [[left, y], [right, y], [right + 11, y + 12], [left + 11, y + 12]], "#e9dcff");
  polygon(ctx, [[left, y], [left + 11, y + 12], [left + 11, y + 48], [left, y + 36]], "#795cae");
  polygon(ctx, [[left + 11, y + 12], [right + 11, y + 12], [right + 11, y + 48], [left + 11, y + 48]], "#9878ca");
  ctx.fillStyle = "#bba0ec";
  ctx.fillRect(left + 6, y + 5, STEP_RUN - 10, 4);
  ctx.fillStyle = "rgba(255,255,255,.48)";
  ctx.fillRect(left + 15, y + 17, 3, 24);
  ctx.fillStyle = "rgba(77,51,119,.35)";
  ctx.fillRect(right - 9, y + 13, 4, 30);
}

function drawPerson(
  ctx: CanvasRenderingContext2D,
  x: number,
  footY: number,
  facing: Direction,
  now: number,
  moving: boolean,
  falling: boolean,
  silhouetteColor?: string,
  opacity = 1,
) {
  const unit = 4;
  const stride = moving ? Math.sin(now / 42) : 0.34 + Math.sin(now / 360) * 0.06;
  const legDrive = stride * 3.2;
  const armSwing = moving ? stride * 2.2 : 0.42;
  const bounce = moving ? Math.round(Math.sin(now / 42) * 0.5) : 0;
  const silhouette = Boolean(silhouetteColor);
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.translate(Math.round(x), Math.round(footY));
  if (facing === "left") ctx.scale(-1, 1);
  ctx.rotate(facing === "right" ? (moving ? 0.2 : 0.11) : (moving ? -0.2 : -0.11));
  if (falling) {
    ctx.translate(9, -5);
    ctx.rotate(Math.min(1.1, Math.max(0, (now % 1000) / 500)));
  }

  const colors = {
    outline: "#30263f",
    hair: "#59372f",
    hairLight: "#8b5740",
    hairShadow: "#432d30",
    skin: "#f1c6a6",
    skinShade: "#d99c83",
    jacket: "#3e3e62",
    jacketLight: "#65658f",
    jacketShade: "#30324e",
    shirt: "#fff8ed",
    shirtShade: "#d9d1e4",
    tie: "#7750a0",
    tieLight: "#b89ad7",
    trousers: "#34334f",
    trouserLight: "#5a5877",
    shoe: "#332b3a",
    shoeLight: "#6b5364",
    bag: "#76538f",
    bagLight: "#b493d1",
    lens: "#e6f1f2",
    tired: "#8b5f66",
  };

  const color = (key: keyof typeof colors) => silhouetteColor ?? colors[key];
  const shape = (points: Array<[number, number]>, key: keyof typeof colors, outlined = true) => {
    const scaled = points.map(([px, py]) => [px * unit, py * unit] as [number, number]);
    polygon(ctx, scaled, color(key));
    if (outlined && !silhouette) {
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "miter";
      ctx.stroke();
    }
  };
  const pixel = (px: number, py: number, width: number, height: number, key: keyof typeof colors) => {
    ctx.fillStyle = color(key);
    ctx.fillRect(px * unit, py * unit, width * unit, height * unit);
  };

  // The trailing leg pushes off while the leading knee lifts up the stair.
  shape(
    [
      [-4, -20 + bounce], [4, -20 + bounce], [5 + legDrive, -14 + bounce],
      [4 + legDrive, -10 + bounce], [7 + legDrive, -5], [5 + legDrive, -3],
      [1 + legDrive, -5], [-1 + legDrive, -10 + bounce], [-3, -14 + bounce],
    ],
    "trousers",
  );
  shape(
    [
      [-3, -20 + bounce], [3, -19 + bounce], [1 - legDrive, -14 + bounce],
      [-4 - legDrive, -11 + bounce], [-7 - legDrive, -6], [-11 - legDrive, -5],
      [-10 - legDrive, -8], [-7 - legDrive, -14 + bounce],
    ],
    "trousers",
  );
  pixel(-2, -16 + bounce, 2, 5, "trouserLight");
  pixel(3 + legDrive, -11 + bounce, 1, 3, "trouserLight");
  shape(
    [
      [-7 - legDrive, -7], [-3 - legDrive, -7], [-2 - legDrive, -4],
      [-4 - legDrive, -2], [-12 - legDrive, -2], [-13 - legDrive, -4],
    ],
    "shoe",
  );
  shape(
    [
      [4 + legDrive, -5], [8 + legDrive, -5], [11 + legDrive, -3],
      [10 + legDrive, -2], [3 + legDrive, -2], [2 + legDrive, -3],
    ],
    "shoe",
  );
  pixel(-10 - legDrive, -4, 5, 1, "shoeLight");
  pixel(5 + legDrive, -4, 4, 1, "shoeLight");

  // Swinging arms overlap the shoulders and bend at the elbow.
  shape(
    [
      [-5, -33 + bounce], [-2, -32 + bounce], [-4 - armSwing, -28 + bounce],
      [-8 - armSwing, -25 + bounce], [-10 - armSwing, -26 + bounce],
      [-9 - armSwing, -30 + bounce],
    ],
    "jacketShade",
  );
  shape(
    [
      [4, -33 + bounce], [7, -32 + bounce], [9 + armSwing, -29 + bounce],
      [12 + armSwing, -27 + bounce], [11 + armSwing, -25 + bounce],
      [8 + armSwing, -26 + bounce], [5, -28 + bounce],
    ],
    "jacket",
  );
  pixel(-11 - armSwing, -26 + bounce, 3, 2, "skin");
  pixel(10 + armSwing, -26 + bounce, 3, 2, "skin");

  // A little work satchel stays attached to the rear hand.
  shape(
    [
      [-10 - armSwing, -26 + bounce], [-8 - armSwing, -26 + bounce],
      [-8 - armSwing, -23 + bounce], [-10 - armSwing, -23 + bounce],
    ],
    "bag",
    false,
  );
  shape(
    [
      [-14 - armSwing, -24 + bounce], [-7 - armSwing, -24 + bounce],
      [-6 - armSwing, -23 + bounce], [-7 - armSwing, -18 + bounce],
      [-15 - armSwing, -18 + bounce], [-16 - armSwing, -19 + bounce],
    ],
    "bag",
  );
  pixel(-14 - armSwing, -23 + bounce, 6, 1, "bagLight");
  pixel(-12 - armSwing, -20 + bounce, 2, 1, "tieLight");

  // Short neck joins the oversized head into sloped jacket shoulders.
  shape([[-2, -39 + bounce], [3, -39 + bounce], [3, -34 + bounce], [-3, -34 + bounce]], "skin");
  shape(
    [
      [-3, -36 + bounce], [-7, -34 + bounce], [-9, -31 + bounce],
      [-7, -26 + bounce], [-6, -21 + bounce], [-4, -19 + bounce],
      [4, -19 + bounce], [6, -21 + bounce], [8, -27 + bounce],
      [7, -32 + bounce], [3, -36 + bounce],
    ],
    "jacket",
  );
  shape(
    [
      [-3, -35 + bounce], [0, -32 + bounce], [3, -35 + bounce],
      [4, -27 + bounce], [3, -21 + bounce], [-3, -21 + bounce],
      [-4, -27 + bounce],
    ],
    "shirt",
    false,
  );
  shape([[-3, -35 + bounce], [0, -32 + bounce], [-2, -28 + bounce], [-6, -34 + bounce]], "jacketLight", false);
  shape([[3, -35 + bounce], [0, -32 + bounce], [2, -28 + bounce], [6, -34 + bounce]], "jacketShade", false);
  shape([[-1, -32 + bounce], [1, -32 + bounce], [2, -29 + bounce], [3, -24 + bounce], [1, -22 + bounce], [0, -24 + bounce]], "tie");
  pixel(0, -31 + bounce, 2, 1, "tieLight");
  pixel(-3, -28 + bounce, 2, 1, "shirtShade");
  pixel(3, -25 + bounce, 2, 1, "shirtShade");
  pixel(-4, -24 + bounce, 2, 1, "jacketLight");
  shape([[-5, -22 + bounce], [5, -22 + bounce], [4, -19 + bounce], [-4, -19 + bounce]], "jacketShade");
  pixel(-4, -21 + bounce, 8, 1, "jacketLight");
  pixel(-1, -22 + bounce, 2, 1, "tieLight");

  // A tired, tousled arcade face: oversized head, swept tufts and heavy glasses.
  shape(
    [
      [-5, -52 + bounce], [-1, -54 + bounce], [1, -52 + bounce],
      [3, -55 + bounce], [4, -51 + bounce], [7, -50 + bounce],
      [8, -46 + bounce], [7, -41 + bounce], [5, -38 + bounce],
      [2, -36 + bounce], [-4, -37 + bounce], [-7, -40 + bounce],
      [-8, -45 + bounce], [-7, -50 + bounce],
    ],
    "hair",
  );
  pixel(-3, -52 + bounce, 4, 1, "hairLight");
  pixel(2, -53 + bounce, 2, 1, "hairLight");
  pixel(-7, -48 + bounce, 3, 3, "hairShadow");
  shape(
    [
      [-5, -47 + bounce], [-3, -49 + bounce], [3, -49 + bounce],
      [6, -47 + bounce], [6, -42 + bounce], [4, -39 + bounce],
      [1, -37 + bounce], [-3, -38 + bounce], [-6, -41 + bounce],
      [-6, -45 + bounce],
    ],
    "skin",
    false,
  );
  pixel(5, -44 + bounce, 2, 3, "skinShade");
  shape(
    [
      [-7, -46 + bounce], [-5, -50 + bounce], [-2, -51 + bounce],
      [0, -49 + bounce], [2, -51 + bounce], [5, -50 + bounce],
      [7, -47 + bounce], [4, -46 + bounce], [2, -47 + bounce],
      [-1, -46 + bounce], [-4, -47 + bounce],
    ],
    "hairLight",
    false,
  );

  // Heavy rounded frames, drooping lids, tiny nose and tired crooked mouth.
  pixel(-6, -46 + bounce, 4, 1, "outline");
  pixel(-7, -45 + bounce, 1, 3, "outline");
  pixel(-6, -42 + bounce, 4, 1, "outline");
  pixel(-5, -45 + bounce, 2, 2, "lens");
  pixel(-5, -44 + bounce, 1, 1, "outline");
  pixel(-3, -45 + bounce, 1, 1, "tired");
  pixel(-2, -45 + bounce, 1, 2, "outline");
  pixel(-1, -46 + bounce, 5, 1, "outline");
  pixel(3, -45 + bounce, 1, 4, "outline");
  pixel(-1, -42 + bounce, 5, 1, "outline");
  pixel(0, -45 + bounce, 3, 3, "lens");
  pixel(1, -44 + bounce, 2, 1, "outline");
  pixel(3, -45 + bounce, 1, 1, "tired");
  pixel(-2, -45 + bounce, 2, 1, "outline");
  pixel(3, -45 + bounce, 3, 1, "outline");
  pixel(5, -45 + bounce, 2, 1, "outline");
  pixel(6, -44 + bounce, 2, 1, "skinShade");
  pixel(7, -43 + bounce, 3, 1, "skin");
  pixel(6, -42 + bounce, 3, 1, "skinShade");
  pixel(-1, -41 + bounce, 2, 1, "skinShade");
  pixel(1, -40 + bounce, 2, 1, "skin");
  pixel(3, -39 + bounce, 2, 1, "tired");

  ctx.restore();
}

function drawAfterimageTrail(
  ctx: CanvasRenderingContext2D,
  x: number,
  footY: number,
  direction: Direction,
  now: number,
  strength: number,
  extended: boolean,
) {
  if (strength <= 0) return;

  const rear = direction === "right" ? -1 : 1;
  const distances = extended ? [132, 101, 70, 39] : [88, 65, 42, 20];
  const colors = ["#eee9ff", "#c2adff", "#a78be0", "#8e6bc4"];
  const alpha = extended ? [0.43, 0.5, 0.59, 0.68] : [0.28, 0.38, 0.5, 0.64];

  for (let index = 0; index < distances.length; index += 1) {
    const distance = distances[index];
    const pulse = 1 + Math.sin(now / 20 + index * 1.3) * 0.025;
    drawPerson(
      ctx,
      x + rear * distance * pulse,
      footY + distance * 0.43,
      direction,
      now - index * 28,
      true,
      false,
      colors[index],
      alpha[index] * strength,
    );
  }
}

function drawSpeedTrail(
  ctx: CanvasRenderingContext2D,
  x: number,
  footY: number,
  direction: Direction,
  progress: number,
  now: number,
  opacity = 1,
) {
  const fade = Math.sin(Math.PI * progress) * opacity;
  if (fade <= 0) return;

  const rear = direction === "right" ? -1 : 1;
  const drift = (1 - progress) * 18;
  const fragments = [
    { distance: 22, rise: 5, width: 25, height: 7, color: "#6f52a8", alpha: 0.8 },
    { distance: 35, rise: 13, width: 34, height: 6, color: "#9b7ed8", alpha: 0.9 },
    { distance: 48, rise: 23, width: 22, height: 6, color: "#d8c9ff", alpha: 0.95 },
    { distance: 29, rise: 33, width: 17, height: 5, color: "#fff", alpha: 0.8 },
    { distance: 62, rise: 10, width: 15, height: 5, color: "#8064b4", alpha: 0.7 },
    { distance: 68, rise: 29, width: 12, height: 4, color: "#b99be9", alpha: 0.75 },
  ];

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  fragments.forEach((fragment, index) => {
    const shimmer = Math.sin(now / 15 + index * 1.7) * 2;
    const px = Math.round(x + rear * (fragment.distance + drift * 0.25));
    const py = Math.round(footY + fragment.rise + drift * 0.35 + shimmer);
    ctx.globalAlpha = fade * fragment.alpha;
    ctx.fillStyle = fragment.color;
    ctx.fillRect(px, py, fragment.width, fragment.height);
  });

  const particles = [
    { distance: 43, rise: 2, size: 5, color: "#fff" },
    { distance: 73, rise: 17, size: 4, color: "#d8c9ff" },
    { distance: 31, rise: 42, size: 4, color: "#9b7ed8" },
    { distance: 88, rise: 35, size: 3, color: "#fff" },
  ];
  particles.forEach((particle, index) => {
    const scatter = ((now / 8 + index * 13) % 16) - 8;
    const px = Math.round(x + rear * (particle.distance + drift + Math.abs(scatter)));
    const py = Math.round(footY + particle.rise + scatter);
    ctx.globalAlpha = fade * 0.8;
    ctx.fillStyle = particle.color;
    ctx.fillRect(px, py, particle.size, particle.size);
  });
  ctx.restore();
}

function drawDirectionCue(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: Direction,
  opacity: number,
) {
  const sign = direction === "right" ? 1 : -1;
  const pixel = (dx: number, dy: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x + dx * sign), Math.round(y + dy), 7, 7);
  };

  ctx.save();
  ctx.globalAlpha = opacity;
  pixel(-14, 12, "#6f52a8");
  pixel(-6, 5, "#9b7ed8");
  pixel(2, -2, "#d8c9ff");
  pixel(10, -9, "#6f52a8");
  pixel(10, -16, "#6f52a8");
  pixel(17, -9, "#6f52a8");
  ctx.restore();
}

function renderGame(
  ctx: CanvasRenderingContext2D,
  engine: Engine,
  now: number,
) {
  const move = engine.move;
  const progress = move
    ? Math.min(1, (now - move.startedAt) / move.duration)
    : 0;
  const eased = progress * progress * (3 - 2 * progress);
  const scrolling = move?.kind === "climb" ? eased * STEP_RISE : 0;
  const shake = move?.kind === "fall" ? Math.sin(now / 18) * Math.max(0, 1 - progress) * 8 : 0;

  drawBackground(ctx, now, engine.score * STEP_RISE + scrolling);
  const platforms = makePlatforms(engine.history, engine.stairs, scrolling);
  platforms.forEach((platform) => {
    if (platform.y > -70 && platform.y < HEIGHT + 60) drawPlatform(ctx, platform, shake);
  });

  const current = platforms.find((platform) => platform.current);
  const next = platforms.find((platform) => platform.next);
  let x = current?.x ?? WIDTH / 2;
  let footY = (current?.y ?? PLAYER_BASELINE) - 4;
  let facing = engine.facing;
  let moving = false;
  let falling = false;
  if (move?.kind === "climb" && current && next) {
    x += (next.x - current.x) * eased;
    footY -= Math.sin(Math.PI * progress) * 34;
    facing = move.direction;
    moving = true;
  } else if (move?.kind === "fall") {
    x += (move.direction === "right" ? 1 : -1) * progress * 34;
    footY += eased * 95;
    facing = move.direction;
    falling = true;
  }

  const introElapsed = now - engine.introStartedAt;
  const isIntroCue = engine.score === 0 && engine.introStartedAt > 0 && introElapsed < 2800 && !move && current;
  if (move?.kind === "climb") {
    const fade = Math.min(1, Math.max(0, (1 - progress) * 1.4));
    drawAfterimageTrail(ctx, x, footY, move.direction, now, fade, false);
    drawSpeedTrail(ctx, x, footY, move.direction, progress, now, fade);
  } else if (isIntroCue) {
    const opacity = Math.max(0, 1 - introElapsed / 2800);
    drawAfterimageTrail(ctx, x, footY, engine.facing, now, opacity, true);
    drawSpeedTrail(ctx, x, footY, engine.facing, 0.48 + Math.sin(now / 90) * 0.08, now, opacity);
    drawDirectionCue(ctx, x + (engine.facing === "right" ? 52 : -52), footY - 94, engine.facing, opacity);
  }
  if (current) drawPerson(ctx, x, footY, facing, now, moving, falling);

  const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 180, WIDTH / 2, HEIGHT / 2, 570);
  vignette.addColorStop(0, "rgba(255,255,255,0)");
  vignette.addColorStop(1, "rgba(75,52,113,.18)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function makeHud(engine: Engine): Hud {
  return {
    status: engine.status,
    score: engine.score,
    best: engine.best,
    time: engine.time,
    newRecord: engine.newRecord,
  };
}

export function AdminStairsGame() {
  const [hud, setHud] = useState<Hud>(() => makeHud(makeEngine()));
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameFrameRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine>(makeEngine());

  const updateHud = useCallback(() => setHud(makeHud(engineRef.current)), []);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY));
      const best = Number.isSafeInteger(saved) && saved > 0 ? saved : 0;
      engineRef.current = makeEngine(best);
      updateHud();
    } catch {
      setStorageUnavailable(true);
    }
  }, [updateHud]);

  const startGame = useCallback(() => {
    const previous = engineRef.current;
    const stairs = createStairs(VISIBLE_AHEAD);
    engineRef.current = {
      ...makeEngine(previous.best),
      status: "playing",
      stairs,
      facing: stairs[0],
      introStartedAt: performance.now(),
    };
    updateHud();
    gameFrameRef.current?.focus();
  }, [updateHud]);

  const restartGame = useCallback(() => {
    engineRef.current = makeEngine(engineRef.current.best);
    updateHud();
  }, [updateHud]);

  useEffect(() => {
    if (hud.status !== "playing") return;
    gameFrameRef.current?.focus();
  }, [hud.status]);

  useEffect(() => {
    if (hud.status !== "playing") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault();
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const current = engineRef.current;
      if (current.status !== "playing" || current.move) return;

      const activeElement = document.activeElement;
      const outsideGame =
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        !gameFrameRef.current?.contains(activeElement);
      if (outsideGame) return;

      const reverse = event.code === "Enter";
      const direction = reverse
        ? current.facing === "right"
          ? "left"
          : "right"
        : current.facing;
      const expected = current.stairs[0];
      const isCorrect = direction === expected;
      current.move = {
        kind: isCorrect ? "climb" : "fall",
        direction,
        startedAt: performance.now(),
        duration: Math.max(150, 255 - Math.min(90, current.score * 1.2)),
      };
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hud.status]);

  useEffect(() => {
    if (hud.status !== "playing") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let frame = 0;
    let lastTime = performance.now();
    let lastHudTime = lastTime;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
      ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const finish = () => {
      const engine = engineRef.current;
      engine.status = "over";
      engine.move = null;
      engine.newRecord = engine.score > engine.best;
      if (engine.newRecord) {
        engine.best = engine.score;
        try {
          window.localStorage.setItem(STORAGE_KEY, String(engine.best));
        } catch {
          setStorageUnavailable(true);
        }
      }
      updateHud();
    };

    const tick = (now: number) => {
      const engine = engineRef.current;
      const delta = Math.min(50, now - lastTime);
      lastTime = now;

      if (engine.move) {
        const progress = (now - engine.move.startedAt) / engine.move.duration;
        if (progress >= 1) {
          const completed = engine.move;
          engine.move = null;
          if (completed.kind === "fall") {
            finish();
          } else {
            engine.history = [...engine.history, completed.direction].slice(-MAX_HISTORY);
            const remaining = engine.stairs.slice(1);
            engine.stairs = [...remaining, nextStair(remaining)];
            engine.facing = completed.direction;
            engine.score += 1;
            engine.time = Math.min(MAX_TIME, engine.time + 1300);
          }
        }
      }

      if (engineRef.current.status === "playing") {
        const current = engineRef.current;
        const drainPerSecond = Math.min(3000, 850 + current.score * 42);
        current.time = Math.max(0, current.time - (drainPerSecond * delta) / 1000);
        if (current.time <= 0) finish();
      }

      renderGame(ctx, engineRef.current, now);
      if (now - lastHudTime >= 100 || engineRef.current.status !== "playing") {
        updateHud();
        lastHudTime = now;
      }
      if (engineRef.current.status === "playing") frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
    };
  }, [hud.status, updateHud]);

  const timePercent = Math.max(0, Math.min(100, (hud.time / MAX_TIME) * 100));

  return (
    <section
      aria-labelledby="admin-stairs-game-title"
      className="rounded-2xl border border-[#4B3B71]/15 bg-white p-4 shadow-sm sm:p-6"
    >
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#79699e]">BREAK TIME</p>
        <h2 id="admin-stairs-game-title" className="mt-1 text-xl font-bold text-[#302344] sm:text-2xl">
          미니게임
        </h2>
      </div>

      <div className="admin-stairs-game-mobile rounded-xl bg-[#f8f4ff] px-4 py-8 text-center text-sm font-medium text-[#66577f]">
        이 미니게임은 PC에서만 이용할 수 있습니다.
      </div>

      <div className="admin-stairs-game-desktop mx-auto max-w-[940px] overflow-hidden rounded-xl border border-[#b7a4dd] bg-[#eee8ff] p-3 shadow-[0_8px_24px_rgba(75,59,113,.16)] sm:p-5">
        {hud.status === "ready" ? (
          <div className="flex min-h-[570px] flex-col items-center justify-center gap-5 rounded-lg bg-gradient-to-b from-[#d9cbff] via-[#eee9ff] to-[#f8f4ff] p-5 sm:p-8">
            <div className="relative aspect-video w-full max-w-[840px] overflow-hidden border-4 border-white/80 bg-[#e9e1ff] shadow-[0_8px_0_rgba(111,82,168,.25)]">
              <Image
                src="/images/stairs.png"
                alt="공명의계단 미니게임 시작 화면"
                fill
                priority
                sizes="(min-width: 1024px) 840px, 90vw"
                className="object-contain"
              />
            </div>
            <button
              type="button"
              onClick={startGame}
              className="border-2 border-[#6f52a8] bg-[#f4d86a] px-14 py-3 font-mono text-2xl font-black text-[#35284f] shadow-[0_5px_0_#6f52a8] transition hover:-translate-y-0.5 hover:bg-[#ffe992] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white active:translate-y-1 active:shadow-[0_1px_0_#6f52a8]"
            >
              Start!
            </button>
          </div>
        ) : (
          <div className="relative overflow-hidden border-2 border-[#8e76bd] bg-[#e9e1ff]">
            <div className="flex min-h-[76px] items-center justify-between gap-4 border-b-2 border-[#8e76bd] bg-[#f8f4ff] px-5 py-3 font-mono text-[#35284f]">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-[10px] font-black tracking-[0.2em] text-[#78649e]">SCORE</p>
                  <p aria-live="polite" className="text-3xl font-black leading-none">
                    {String(hud.score).padStart(3, "0")}
                  </p>
                </div>
                <div className="hidden h-10 w-px bg-[#b6a5d7] sm:block" />
                <div className="hidden sm:block">
                  <p className="text-[10px] font-black tracking-[0.2em] text-[#78649e]">BEST</p>
                  <p className="text-xl font-black leading-none">{String(hud.best).padStart(3, "0")}</p>
                </div>
              </div>
              <div className="w-[48%] max-w-[400px]">
                <div className="mb-1 flex justify-between text-[10px] font-black tracking-[0.2em]">
                  <span>TIME</span>
                  <span>{Math.ceil(hud.time / 1000)}s</span>
                </div>
                <div
                  className="h-4 border-2 border-[#6f52a8] bg-white p-[2px]"
                  role="progressbar"
                  aria-label="제한 시간"
                  aria-valuemin={0}
                  aria-valuemax={MAX_TIME}
                  aria-valuenow={Math.round(hud.time)}
                >
                  <div
                    className={`h-full transition-[width] duration-100 ${timePercent < 25 ? "bg-[#d96986]" : "bg-[#9b7ed8]"}`}
                    style={{ width: `${timePercent}%` }}
                  />
                </div>
              </div>
            </div>

            <div
              ref={gameFrameRef}
              tabIndex={-1}
              className="relative outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#f4d86a]"
              aria-label="계단 오르기 게임 영역"
            >
              <canvas
                ref={canvasRef}
                className="block aspect-[900/560] w-full [image-rendering:pixelated]"
                aria-label="연보라색 도시 배경에서 캐릭터가 계단을 오르는 장면"
              />

              {hud.status === "over" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-[#554078]/65 p-5">
                  <div className="w-full max-w-sm border-4 border-white bg-[#eee8ff] px-6 py-5 text-center text-[#35284f] shadow-[8px_8px_0_rgba(63,43,96,.4)]">
                    {hud.newRecord ? (
                      <p className="font-mono text-sm font-black tracking-[0.25em] text-[#916d17]">NEW RECORD!</p>
                    ) : null}
                    <h3 className="mt-1 font-mono text-3xl font-black tracking-widest">GAME OVER</h3>
                    <div className="mt-4 flex justify-center gap-10">
                      <p className="text-left text-xs font-black tracking-widest text-[#78649e]">
                        SCORE
                        <span className="mt-1 block font-mono text-3xl text-[#35284f]">
                          {String(hud.score).padStart(3, "0")}
                        </span>
                      </p>
                      <p className="text-left text-xs font-black tracking-widest text-[#78649e]">
                        BEST
                        <span className="mt-1 block font-mono text-3xl text-[#35284f]">
                          {String(hud.best).padStart(3, "0")}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={restartGame}
                      className="mt-5 border-2 border-[#6f52a8] bg-[#f4d86a] px-8 py-2 font-bold shadow-[0_3px_0_#6f52a8] transition hover:bg-[#ffe992] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6f52a8]"
                    >
                      다시하기
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t-2 border-[#8e76bd] bg-[#f8f4ff] px-4 py-3 text-xs font-bold text-[#493967] sm:px-6">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-2">
                  <kbd className="border-2 border-[#9b7ed8] bg-white px-2 py-1 font-mono font-black">SPACE</kbd>
                  오르기
                </span>
                <span className="inline-flex items-center gap-2">
                  <kbd className="border-2 border-[#9b7ed8] bg-white px-2 py-1 font-mono font-black">ENTER</kbd>
                  방향전환
                </span>
              </div>
              {storageUnavailable ? <span>최고 기록을 저장할 수 없습니다.</span> : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
