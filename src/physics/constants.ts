export const GRAVITY = 9.81;
export const BALL_MASS = 0.04593; // kg
export const BALL_RADIUS = 0.021335; // m
export const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;
export const AIR_DENSITY = 1.225; // kg/m^3
export const CUP_RADIUS = 0.054; // m (4.25 in diameter)
export const RPM_TO_RADS = (2 * Math.PI) / 60;

/** Fixed physics step. */
export const PHYSICS_DT = 1 / 240;
/** Recorded trajectory frame interval (playback runs at real time). */
export const FRAME_DT = 1 / 60;
/** Hard cap on simulated time for one shot. */
export const MAX_SHOT_TIME = 40;
