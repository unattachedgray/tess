/** Compact ECO chess opening database with UCI move notation. */

export interface Opening {
	eco: string;
	name: string;
	moves: string;
}

// Each entry: [eco, name, moves (UCI)]
const RAW: [string, string, string][] = [
	// A00-A09: Irregular / Flank
	["A00", "Polish Opening", "b2b4"],
	["A00", "Grob Attack", "g2g4"],
	["A01", "Nimzo-Larsen Attack", "b2b3"],
	["A02", "Bird Opening", "f2f4"],
	["A04", "Reti Opening", "g1f3"],
	["A05", "Reti: KIA Setup", "g1f3 g8f6 g2g3"],
	["A06", "Reti: d5", "g1f3 d7d5"],
	["A07", "Reti: KIA", "g1f3 d7d5 g2g3"],
	["A09", "Reti Accepted", "g1f3 d7d5 c2c4 d5c4"],
	// A10-A39: English
	["A10", "English Opening", "c2c4"],
	["A13", "English: Agincourt", "c2c4 e7e6"],
	["A15", "English: Anglo-Indian", "c2c4 g8f6"],
	["A16", "English: Anglo-Indian Mikenas", "c2c4 g8f6 b1c3"],
	["A20", "English: Reversed Sicilian", "c2c4 e7e5"],
	["A22", "English: Bremen", "c2c4 e7e5 b1c3"],
	["A25", "English: Closed", "c2c4 e7e5 b1c3 b8c6"],
	["A26", "English: Closed Botvinnik", "c2c4 e7e5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6"],
	["A30", "English: Symmetrical", "c2c4 c7c5"],
	["A33", "English: Symmetrical Two Knights", "c2c4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4"],
	["A36", "English: Ultra-Symmetrical", "c2c4 c7c5 b1c3 b8c6 g2g3 g7g6"],
	// D00-D05: Queen Pawn / QGD
	["A40", "Queen Pawn Game", "d2d4"],
	["A45", "Indian Defense", "d2d4 g8f6"],
	["A46", "Indian: London System", "d2d4 g8f6 g1f3 e7e6 c1f4"],
	["A48", "Indian: Torre Attack", "d2d4 g8f6 g1f3 g7g6 c1g5"],
	["A51", "Budapest Gambit", "d2d4 g8f6 c2c4 e7e5"],
	["A52", "Budapest Gambit Accepted", "d2d4 g8f6 c2c4 e7e5 d4e5 f6g4"],
	["A56", "Benoni Defense", "d2d4 g8f6 c2c4 c7c5"],
	["A57", "Benko Gambit", "d2d4 g8f6 c2c4 c7c5 d4d5 b7b5"],
	["A60", "Modern Benoni", "d2d4 g8f6 c2c4 c7c5 d4d5 e7e6 b1c3 e6d5 c4d5 d7d6"],
	["A80", "Dutch Defense", "d2d4 f7f5"],
	["A83", "Dutch Staunton Gambit", "d2d4 f7f5 e2e4"],
	["A87", "Dutch Leningrad", "d2d4 f7f5 c2c4 g8f6 g2g3 g7g6 f1g2 f8g7"],
	// D06-D69: Queen's Gambit
	["D06", "Queen's Gambit", "d2d4 d7d5 c2c4"],
	["D07", "Chigorin Defense", "d2d4 d7d5 c2c4 b8c6"],
	["D10", "QGD Slav", "d2d4 d7d5 c2c4 c7c6"],
	["D11", "Slav: 3.Nf3", "d2d4 d7d5 c2c4 c7c6 g1f3"],
	["D15", "Slav: 4.Nc3", "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3"],
	["D17", "Slav: Czech Variation", "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5"],
	["D20", "QGA", "d2d4 d7d5 c2c4 d5c4"],
	["D23", "QGA: 3.Nf3", "d2d4 d7d5 c2c4 d5c4 g1f3"],
	["D27", "QGA Classical", "d2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1"],
	["D30", "QGD", "d2d4 d7d5 c2c4 e7e6"],
	["D31", "QGD: Semi-Tarrasch", "d2d4 d7d5 c2c4 e7e6 b1c3"],
	["D35", "QGD Exchange", "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c4d5 e6d5"],
	["D37", "QGD: 5.Bf4", "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 g1f3 f8e7 c1f4"],
	["D43", "QGD Semi-Slav", "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 e7e6"],
	["D45", "Semi-Slav: Meran", "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 e7e6 e2e3"],
	["D53", "QGD: Classical", "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 g1f3 f8e7 c1g5"],
	["D63", "QGD Orthodox", "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 g1f3 f8e7 c1g5 e8g8 e2e3 b8d7"],
	// E00-E19: Catalan / Nimzo
	["E00", "Catalan Opening", "d2d4 g8f6 c2c4 e7e6 g2g3"],
	["E04", "Catalan: Open", "d2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 d5c4"],
	["E06", "Catalan: Closed", "d2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 f8e7"],
	["E12", "Queen's Indian", "d2d4 g8f6 c2c4 e7e6 g1f3 b7b6"],
	["E15", "Queen's Indian: Fianchetto", "d2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3"],
	["E17", "Queen's Indian: Classical", "d2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7"],
	["E20", "Nimzo-Indian", "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4"],
	["E21", "Nimzo-Indian: Three Knights", "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 g1f3"],
	["E24", "Nimzo-Indian: Saemisch", "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 a2a3 b4c3 b2c3"],
	["E32", "Nimzo-Indian: Classical", "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 d1c2"],
	["E41", "Nimzo-Indian: Huebner", "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 c7c5"],
	["E46", "Nimzo-Indian: Reshevsky", "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8"],
	// E60-E99: King's Indian
	["E60", "King's Indian", "d2d4 g8f6 c2c4 g7g6"],
	["E62", "King's Indian: Fianchetto", "d2d4 g8f6 c2c4 g7g6 g2g3 f8g7 f1g2 d7d6 g1f3"],
	["E70", "King's Indian: 4.e4", "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4"],
	["E73", "King's Indian: Averbakh", "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 c1e3"],
	["E76", "King's Indian: Four Pawns", "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f4"],
	["E80", "King's Indian: Saemisch", "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f3"],
	[
		"E85",
		"King's Indian: Saemisch Orthodox",
		"d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f3 e8g8 c1e3 e7e5",
	],
	["E90", "King's Indian: Classical", "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3"],
	[
		"E92",
		"King's Indian: Classical Petrosian",
		"d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 d4d5",
	],
	[
		"E97",
		"King's Indian: Mar del Plata",
		"d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6",
	],
	[
		"E99",
		"King's Indian: Mar del Plata Main",
		"d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6 d4d5 c6e7 f3e1 f6d7",
	],
	// D70-D99: Gruenfeld
	["D70", "Gruenfeld Defense", "d2d4 g8f6 c2c4 g7g6 b1c3 d7d5"],
	["D80", "Gruenfeld: Stockholm", "d2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c1g5"],
	["D85", "Gruenfeld: Exchange", "d2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3"],
	["D90", "Gruenfeld: Russian", "d2d4 g8f6 c2c4 g7g6 b1c3 d7d5 g1f3 f8g7 d1b3"],
	// B00-B09: e4 misc
	["B00", "Owen Defense", "e2e4 b7b6"],
	["B00", "Nimzowitsch Defense", "e2e4 b8c6"],
	["B01", "Scandinavian Defense", "e2e4 d7d5"],
	["B01", "Scandinavian: Mieses-Kotrc", "e2e4 d7d5 e4d5 d8d5"],
	["B02", "Alekhine Defense", "e2e4 g8f6"],
	["B03", "Alekhine: Four Pawns", "e2e4 g8f6 e4e5 f6d5 d2d4 d7d6 c2c4 d5b6 f2f4"],
	["B06", "Modern Defense", "e2e4 g7g6"],
	["B07", "Pirc Defense", "e2e4 d7d6 d2d4 g8f6 b1c3"],
	["B09", "Pirc: Austrian Attack", "e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 f2f4"],
	// B10-B19: Caro-Kann
	["B10", "Caro-Kann Defense", "e2e4 c7c6"],
	["B12", "Caro-Kann: Advance", "e2e4 c7c6 d2d4 d7d5 e4e5"],
	["B13", "Caro-Kann: Exchange", "e2e4 c7c6 d2d4 d7d5 e4d5 c6d5"],
	["B14", "Caro-Kann: Panov-Botvinnik", "e2e4 c7c6 d2d4 d7d5 e4d5 c6d5 c2c4"],
	["B15", "Caro-Kann: Main Line", "e2e4 c7c6 d2d4 d7d5 b1c3"],
	["B18", "Caro-Kann: Classical", "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5"],
	["B19", "Caro-Kann: Classical Main", "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 g1f3"],
	// B20-B99: Sicilian
	["B20", "Sicilian Defense", "e2e4 c7c5"],
	["B21", "Sicilian: Smith-Morra Gambit", "e2e4 c7c5 d2d4 c5d4 c2c3"],
	["B22", "Sicilian: Alapin", "e2e4 c7c5 c2c3"],
	["B23", "Sicilian: Closed", "e2e4 c7c5 b1c3"],
	["B27", "Sicilian: Hyperaccelerated Dragon", "e2e4 c7c5 g1f3 g7g6"],
	["B30", "Sicilian: Rossolimo", "e2e4 c7c5 g1f3 b8c6 f1b5"],
	["B32", "Sicilian: Open", "e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4"],
	["B33", "Sicilian: Sveshnikov", "e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5"],
	["B35", "Sicilian: Accelerated Dragon", "e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g7g6"],
	["B40", "Sicilian: Pin Variation", "e2e4 c7c5 g1f3 e7e6"],
	["B44", "Sicilian: Taimanov", "e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6"],
	["B47", "Sicilian: Taimanov English Attack", "e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6 b1c3 d8c7"],
	["B50", "Sicilian: 2...d6", "e2e4 c7c5 g1f3 d7d6"],
	["B54", "Sicilian: Open 2...d6", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4"],
	["B56", "Sicilian: Classical", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3"],
	["B60", "Sicilian: Richter-Rauzer", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 b8c6 c1g5"],
	[
		"B63",
		"Sicilian: Richter-Rauzer Classical",
		"e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 b8c6 c1g5 e7e6 d1d2",
	],
	["B70", "Sicilian: Dragon", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6"],
	["B72", "Sicilian: Dragon Classical", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6 c1e3"],
	[
		"B76",
		"Sicilian: Dragon Yugoslav Attack",
		"e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6 c1e3 f8g7 f2f3",
	],
	["B80", "Sicilian: Scheveningen", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e6"],
	[
		"B84",
		"Sicilian: Scheveningen Classical",
		"e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e6 f1e2",
	],
	[
		"B85",
		"Sicilian: Scheveningen 6.Be2 a6",
		"e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e6 f1e2 a7a6",
	],
	["B90", "Sicilian: Najdorf", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6"],
	["B92", "Sicilian: Najdorf Opocensky", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 f1e2"],
	["B94", "Sicilian: Najdorf 6.Bg5", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1g5"],
	[
		"B96",
		"Sicilian: Najdorf English Attack",
		"e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3",
	],
	[
		"B97",
		"Sicilian: Najdorf Poisoned Pawn",
		"e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1g5 e7e6 f2f4 d8b6",
	],
	// C00-C19: French
	["C00", "French Defense", "e2e4 e7e6"],
	["C01", "French: Exchange", "e2e4 e7e6 d2d4 d7d5 e4d5 e6d5"],
	["C02", "French: Advance", "e2e4 e7e6 d2d4 d7d5 e4e5"],
	["C03", "French: Tarrasch", "e2e4 e7e6 d2d4 d7d5 b1d2"],
	["C07", "French: Tarrasch Open", "e2e4 e7e6 d2d4 d7d5 b1d2 c7c5 e4d5 e6d5"],
	["C10", "French: Rubinstein", "e2e4 e7e6 d2d4 d7d5 b1c3 d5e4 c3e4"],
	["C11", "French: Classical", "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6"],
	["C12", "French: MacCutcheon", "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8b4"],
	["C13", "French: Classical Burn", "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 d5e4"],
	["C15", "French: Winawer", "e2e4 e7e6 d2d4 d7d5 b1c3 f8b4"],
	["C18", "French: Winawer Main", "e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3"],
	// C20-C29: King Pawn misc
	["C20", "King's Pawn Game", "e2e4 e7e5"],
	["C21", "Danish Gambit", "e2e4 e7e5 d2d4 e5d4 c2c3"],
	["C22", "Center Game", "e2e4 e7e5 d2d4 e5d4 d1d4"],
	["C23", "Bishop's Opening", "e2e4 e7e5 f1c4"],
	["C25", "Vienna Game", "e2e4 e7e5 b1c3"],
	["C27", "Vienna: Frankenstein-Dracula", "e2e4 e7e5 b1c3 g8f6 f1c4 f6e4"],
	["C29", "Vienna Gambit", "e2e4 e7e5 b1c3 g8f6 f2f4"],
	// C30-C39: King's Gambit
	["C30", "King's Gambit", "e2e4 e7e5 f2f4"],
	["C33", "King's Gambit Accepted", "e2e4 e7e5 f2f4 e5f4"],
	["C36", "King's Gambit: Abbazia", "e2e4 e7e5 f2f4 e5f4 g1f3 d7d5"],
	// C40-C49: Open Game
	["C40", "Latvian Gambit", "e2e4 e7e5 g1f3 f7f5"],
	["C41", "Philidor Defense", "e2e4 e7e5 g1f3 d7d6"],
	["C42", "Petrov Defense", "e2e4 e7e5 g1f3 g8f6"],
	["C43", "Petrov: Stafford Gambit", "e2e4 e7e5 g1f3 g8f6 f3e5 b8c6"],
	["C44", "Scotch Game", "e2e4 e7e5 g1f3 b8c6 d2d4"],
	["C45", "Scotch: Classical", "e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4"],
	["C46", "Three Knights Game", "e2e4 e7e5 g1f3 b8c6 b1c3"],
	["C47", "Four Knights: Scotch", "e2e4 e7e5 g1f3 b8c6 b1c3 g8f6 d2d4"],
	["C48", "Four Knights: Spanish", "e2e4 e7e5 g1f3 b8c6 b1c3 g8f6 f1b5"],
	// C50-C59: Italian
	["C50", "Italian Game", "e2e4 e7e5 g1f3 b8c6 f1c4"],
	["C50", "Italian: Giuoco Piano", "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5"],
	["C51", "Evans Gambit", "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4"],
	["C53", "Italian: Classical", "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3"],
	["C54", "Italian: Main Line", "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4"],
	["C55", "Italian: Two Knights", "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6"],
	["C57", "Two Knights: Fried Liver", "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5 d7d5 e4d5 c6a5"],
	["C58", "Two Knights: Morphy", "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5 d7d5 e4d5 b8a6"],
	// C60-C99: Spanish (Ruy Lopez)
	["C60", "Ruy Lopez", "e2e4 e7e5 g1f3 b8c6 f1b5"],
	["C63", "Ruy Lopez: Schliemann", "e2e4 e7e5 g1f3 b8c6 f1b5 f7f5"],
	["C65", "Ruy Lopez: Berlin", "e2e4 e7e5 g1f3 b8c6 f1b5 g8f6"],
	["C67", "Ruy Lopez: Berlin Wall", "e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 f8e7"],
	["C68", "Ruy Lopez: Exchange", "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5c6"],
	["C70", "Ruy Lopez: Morphy", "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4"],
	["C72", "Ruy Lopez: Modern Steinitz", "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 d7d6"],
	["C78", "Ruy Lopez: Archangelsk", "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 b7b5 a4b3 f8b4"],
	["C80", "Ruy Lopez: Open", "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f6e4"],
	["C84", "Ruy Lopez: Closed", "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7"],
	[
		"C88",
		"Ruy Lopez: Closed Anti-Marshall",
		"e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 e8g8 h2h3",
	],
	[
		"C89",
		"Ruy Lopez: Marshall Attack",
		"e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 e8g8 c2c3 d7d5",
	],
	[
		"C92",
		"Ruy Lopez: Chigorin",
		"e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3",
	],
	[
		"C95",
		"Ruy Lopez: Breyer",
		"e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3 c6b8",
	],
	// B20 addendum — extra popular Sicilian lines already covered above
];

/** Parsed opening database sorted by descending move count for longest-match-first lookup. */
export const OPENINGS: Opening[] = RAW.map(([eco, name, moves]) => ({ eco, name, moves })).sort(
	(a, b) => b.moves.length - a.moves.length,
);

/**
 * Detect the longest matching opening for a given move history.
 * @param moveHistory Array of UCI moves, e.g. ["e2e4", "c7c5", "g1f3"]
 * @returns The matching opening with the most moves, or null if none match.
 */
export function detectOpening(moveHistory: string[]): { eco: string; name: string } | null {
	const joined = moveHistory.join(" ");
	for (const opening of OPENINGS) {
		// The opening moves must be a prefix of the played moves
		if (joined === opening.moves || joined.startsWith(opening.moves + " ")) {
			return { eco: opening.eco, name: opening.name };
		}
	}
	return null;
}
