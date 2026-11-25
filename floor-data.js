'use strict';
// SAMPLE FLOOR for the Floor app. Replace with the restaurant's real tables (later this comes from the RESTRO backend, and
// the owner sets it in Floor › Edit layout, still to be drawn: Update Pack 8, G).
// (Update Pack 8, B) Each area is laid out on one page or across several; each table has its number (`name`), seats, its
// shape (rect, square or round) and where it sits on its page: x, y, w, h in the design's pixels of the 1920 × 1080
// screen, from the top left of the floor (under the Floor's top row). The tables and their places are the Pack 8 designs'.
window.RestroFloorPlan = {
  sample: true,
  areas: [
    { id: 'rooftop', name: 'Rooftop', tables: [
      { id: 'T21', name: '21', seats: 4, shape: 'rect', page: 0, x: 98, y: 70, w: 278, h: 208 },
      { id: 'T22', name: '22', seats: 4, shape: 'rect', page: 0, x: 408, y: 70, w: 278, h: 208 },
      { id: 'T23', name: '23', seats: 2, shape: 'round', page: 0, x: 718, y: 70, w: 208, h: 208 },
      { id: 'T24', name: '24', seats: 2, shape: 'round', page: 0, x: 958, y: 70, w: 208, h: 208 },
      { id: 'T25', name: '25', seats: 8, shape: 'rect', page: 0, x: 98, y: 340, w: 358, h: 208 },
      { id: 'T26', name: '26', seats: 8, shape: 'rect', page: 0, x: 488, y: 340, w: 278, h: 208 }
    ] },
    { id: 'ac-hall', name: 'AC hall', tables: [
      { id: 'T1', name: '1', seats: 2, shape: 'round', page: 0, x: 98, y: 80, w: 198, h: 198 },
      { id: 'T2', name: '2', seats: 2, shape: 'round', page: 0, x: 328, y: 80, w: 198, h: 198 },
      { id: 'T3', name: '3', seats: 4, shape: 'rect', page: 0, x: 568, y: 70, w: 278, h: 208 },
      { id: 'T4', name: '4', seats: 4, shape: 'rect', page: 0, x: 878, y: 70, w: 278, h: 208 },
      { id: 'T5', name: '5', seats: 4, shape: 'rect', page: 0, x: 1188, y: 70, w: 258, h: 208 },
      { id: 'T6', name: '6', seats: 4, shape: 'rect', page: 0, x: 1478, y: 70, w: 258, h: 208 },
      { id: 'T7', name: '7', seats: 4, shape: 'rect', page: 0, x: 98, y: 340, w: 278, h: 208 },
      { id: 'T8', name: '8', seats: 4, shape: 'rect', page: 0, x: 408, y: 340, w: 278, h: 208 },
      { id: 'T9', name: '9', seats: 6, shape: 'rect', page: 0, x: 718, y: 340, w: 358, h: 208 },
      { id: 'T10', name: '10', seats: 8, shape: 'rect', page: 0, x: 1108, y: 340, w: 628, h: 208 },
      { id: 'T11', name: '11', seats: 4, shape: 'round', page: 0, x: 328, y: 610, w: 208, h: 208 },
      { id: 'T12', name: '12', seats: 4, shape: 'round', page: 0, x: 588, y: 610, w: 208, h: 208 },
      { id: 'T13', name: '13', seats: 4, shape: 'round', page: 0, x: 848, y: 610, w: 208, h: 208 },
      { id: 'T14', name: '14', seats: 4, shape: 'round', page: 0, x: 1108, y: 610, w: 208, h: 208 },
      { id: 'T15', name: '15', seats: 4, shape: 'rect', page: 1, x: 148, y: 100, w: 278, h: 208 },
      { id: 'T16', name: '16', seats: 4, shape: 'rect', page: 1, x: 468, y: 100, w: 278, h: 208 },
      { id: 'T17', name: '17', seats: 2, shape: 'rect', page: 1, x: 788, y: 100, w: 278, h: 208 },
      { id: 'T18', name: '18', seats: 4, shape: 'rect', page: 1, x: 1108, y: 100, w: 278, h: 208 },
      { id: 'T19', name: '19', seats: 8, shape: 'rect', page: 1, x: 148, y: 380, w: 448, h: 208 },
      { id: 'T20', name: '20', seats: 2, shape: 'round', page: 1, x: 648, y: 380, w: 208, h: 208 }
    ] },
    { id: 'non-ac', name: 'Non-AC', tables: [
      { id: 'T31', name: '31', seats: 4, shape: 'rect', page: 0, x: 98, y: 70, w: 278, h: 208 },
      { id: 'T32', name: '32', seats: 4, shape: 'rect', page: 0, x: 408, y: 70, w: 278, h: 208 },
      { id: 'T33', name: '33', seats: 6, shape: 'rect', page: 0, x: 718, y: 70, w: 358, h: 208 },
      { id: 'T34', name: '34', seats: 2, shape: 'round', page: 0, x: 98, y: 340, w: 208, h: 208 },
      { id: 'T35', name: '35', seats: 2, shape: 'round', page: 0, x: 358, y: 340, w: 208, h: 208 },
      { id: 'T36', name: '36', seats: 6, shape: 'rect', page: 0, x: 618, y: 340, w: 278, h: 208 }
    ] },
    { id: 'patio', name: 'Patio', tables: [
      { id: 'T41', name: '41', seats: 4, shape: 'square', page: 0, x: 98, y: 70, w: 208, h: 208 },
      { id: 'T42', name: '42', seats: 4, shape: 'square', page: 0, x: 358, y: 70, w: 208, h: 208 },
      { id: 'T43', name: '43', seats: 6, shape: 'rect', page: 0, x: 618, y: 70, w: 358, h: 208 },
      { id: 'T44', name: '44', seats: 2, shape: 'round', page: 0, x: 1028, y: 70, w: 208, h: 208 }
    ] },
    { id: 'terrace', name: 'Terrace', tables: [
      { id: 'T51', name: '51', seats: 4, shape: 'rect', page: 0, x: 98, y: 80, w: 278, h: 208 },
      { id: 'T52', name: '52', seats: 2, shape: 'round', page: 0, x: 418, y: 80, w: 208, h: 208 },
      { id: 'T53', name: '53', seats: 6, shape: 'rect', page: 0, x: 668, y: 80, w: 278, h: 208 },
      { id: 'T54', name: '54', seats: 4, shape: 'rect', page: 0, x: 988, y: 80, w: 278, h: 208 },
      { id: 'T55', name: '55', seats: 4, shape: 'round', page: 0, x: 1308, y: 80, w: 208, h: 208 },
      { id: 'T56', name: '56', seats: 4, shape: 'rect', page: 0, x: 98, y: 350, w: 278, h: 208 }
    ] },
    { id: 'private-dining', name: 'Private dining', tables: [
      { id: 'T61', name: '61', seats: 12, shape: 'rect', page: 0, x: 98, y: 70, w: 628, h: 208 },
      { id: 'T62', name: '62', seats: 8, shape: 'rect', page: 0, x: 758, y: 70, w: 448, h: 208 }
    ] },
    { id: 'bar', name: 'Bar', tables: [
      { id: 'T71', name: '71', seats: 2, shape: 'round', page: 0, x: 98, y: 70, w: 198, h: 198 },
      { id: 'T72', name: '72', seats: 2, shape: 'round', page: 0, x: 328, y: 70, w: 198, h: 198 },
      { id: 'T73', name: '73', seats: 2, shape: 'round', page: 0, x: 558, y: 70, w: 198, h: 198 },
      { id: 'T74', name: '74', seats: 2, shape: 'round', page: 0, x: 788, y: 70, w: 198, h: 198 },
      { id: 'T75', name: '75', seats: 4, shape: 'rect', page: 0, x: 98, y: 340, w: 278, h: 208 }
    ] }
  ]
};
