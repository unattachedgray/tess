export { ChessGame } from "./games/chess.js";
export { GoGame } from "./games/go.js";
export { JanggiGame, splitJanggiUci } from "./games/janggi.js";
export * from "./types.js";
export { detectOpening, type Opening } from "./openings.js";
export * from "./evaluation.js";
export * from "./protocol.js";
export { type IGame, type GameDefinition, type GameSnapshot, type MoveResult, type PluginGameResult, GameRegistry } from "./game-interface.js";
export { ChessAdapter, GoAdapter, JanggiAdapter } from "./games/adapters.js";
