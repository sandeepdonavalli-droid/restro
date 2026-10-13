'use strict';
// SAMPLE MENU for the Counter screen. Replace with the restaurant's real menu
// (later this comes from the RESTRO backend). Prices in rupees, before GST.
// veg: true / false is kept in the data (for reports and filters later); it is not shown on screen.
window.RestroMenu = {
  sample: true,
  currency: 'INR',
  taxRate: 0.05,
  taxLabel: 'GST 5%',
  categories: [
    { id: 'south', name: 'South Indian', color: '#d4743a', items: [
      { id: 'masala-dosa', name: 'Masala dosa', price: 180, veg: true, code: 'SI01' },
      { id: 'plain-dosa', name: 'Plain dosa', price: 140, veg: true, code: 'SI02' },
      { id: 'rava-dosa', name: 'Rava dosa', price: 170, veg: true, code: 'SI03' },
      { id: 'idli', name: 'Idli (2 pcs)', price: 60, veg: true, code: 'SI04' },
      { id: 'medu-vada', name: 'Medu vada (2 pcs)', price: 70, veg: true, code: 'SI05' },
      { id: 'uttapam', name: 'Onion uttapam', price: 160, veg: true, code: 'SI06' },
      { id: 'pongal', name: 'Ven pongal', price: 120, veg: true, code: 'SI07' }
    ] },
    { id: 'biryani', name: 'Biryani & Rice', color: '#c9a227', items: [
      { id: 'veg-biryani', name: 'Veg biryani', price: 220, veg: true, code: 'BR01' },
      { id: 'chicken-biryani', name: 'Chicken biryani', price: 280, veg: false, code: 'BR02' },
      { id: 'mutton-biryani', name: 'Mutton biryani', price: 340, veg: false, code: 'BR03' },
      { id: 'veg-pulav', name: 'Veg pulav', price: 180, veg: true, code: 'BR04' },
      { id: 'jeera-rice', name: 'Jeera rice', price: 150, veg: true, code: 'BR05' },
      { id: 'curd-rice', name: 'Curd rice', price: 120, veg: true, code: 'BR06' }
    ] },
    { id: 'north', name: 'North Indian', color: '#c4534a', items: [
      { id: 'paneer-butter', name: 'Paneer butter masala', price: 260, veg: true, code: 'NI01' },
      { id: 'kadai-paneer', name: 'Kadai paneer', price: 270, veg: true, code: 'NI02' },
      { id: 'dal-makhani', name: 'Dal makhani', price: 220, veg: true, code: 'NI03' },
      { id: 'chana-masala', name: 'Chana masala', price: 190, veg: true, code: 'NI04' },
      { id: 'butter-chicken', name: 'Butter chicken', price: 320, veg: false, code: 'NI05' }
    ] },
    { id: 'breads', name: 'Breads', color: '#a7794c', items: [
      { id: 'tandoori-roti', name: 'Tandoori roti', price: 30, veg: true, code: 'BD01' },
      { id: 'butter-naan', name: 'Butter naan', price: 50, veg: true, code: 'BD02' },
      { id: 'garlic-naan', name: 'Garlic naan', price: 60, veg: true, code: 'BD03' },
      { id: 'laccha-paratha', name: 'Laccha paratha', price: 55, veg: true, code: 'BD04' },
      { id: 'kulcha', name: 'Amritsari kulcha', price: 70, veg: true, code: 'BD05' }
    ] },
    { id: 'starters', name: 'Starters', color: '#b8577e', items: [
      { id: 'paneer-tikka', name: 'Paneer tikka', price: 250, veg: true, code: 'ST01' },
      { id: 'gobi-65', name: 'Gobi 65', price: 160, veg: true, code: 'ST02' },
      { id: 'spring-roll', name: 'Veg spring roll', price: 170, veg: true, code: 'ST03' },
      { id: 'chicken-65', name: 'Chicken 65', price: 260, veg: false, code: 'ST04' },
      { id: 'fish-fry', name: 'Fish fry', price: 300, veg: false, code: 'ST05' }
    ] },
    { id: 'chinese', name: 'Indo-Chinese', color: '#3f8f8a', items: [
      { id: 'veg-fried-rice', name: 'Veg fried rice', price: 190, veg: true, code: 'CH01' },
      { id: 'hakka-noodles', name: 'Hakka noodles', price: 190, veg: true, code: 'CH02' },
      { id: 'gobi-manchurian', name: 'Gobi manchurian', price: 180, veg: true, code: 'CH03' },
      { id: 'chilli-paneer', name: 'Chilli paneer', price: 230, veg: true, code: 'CH04' },
      { id: 'chicken-noodles', name: 'Chicken noodles', price: 220, veg: false, code: 'CH05' }
    ] },
    { id: 'chaat', name: 'Chaat & Snacks', color: '#5f9a4c', items: [
      { id: 'pani-puri', name: 'Pani puri', price: 70, veg: true, code: 'CS01' },
      { id: 'bhel-puri', name: 'Bhel puri', price: 80, veg: true, code: 'CS02' },
      { id: 'pav-bhaji', name: 'Pav bhaji', price: 140, veg: true, code: 'CS03' },
      { id: 'samosa', name: 'Samosa (2 pcs)', price: 50, veg: true, code: 'CS04' },
      { id: 'vada-pav', name: 'Vada pav', price: 40, veg: true, code: 'CS05' }
    ] },
    { id: 'beverages', name: 'Beverages', color: '#4d7cb8', items: [
      { id: 'filter-coffee', name: 'Filter coffee', price: 60, veg: true, code: 'BV01' },
      { id: 'masala-chai', name: 'Masala chai', price: 40, veg: true, code: 'BV02' },
      { id: 'sweet-lassi', name: 'Sweet lassi', price: 90, veg: true, code: 'BV03' },
      { id: 'mango-lassi', name: 'Mango lassi', price: 110, veg: true, code: 'BV04' },
      { id: 'buttermilk', name: 'Buttermilk', price: 50, veg: true, code: 'BV05' },
      { id: 'lime-soda', name: 'Fresh lime soda', price: 70, veg: true, code: 'BV06' }
    ] },
    { id: 'desserts', name: 'Desserts', color: '#8a6bb8', items: [
      { id: 'gulab-jamun', name: 'Gulab jamun (2 pcs)', price: 80, veg: true, code: 'DS01' },
      { id: 'rasmalai', name: 'Rasmalai', price: 110, veg: true, code: 'DS02' },
      { id: 'kulfi', name: 'Malai kulfi', price: 90, veg: true, code: 'DS03' },
      { id: 'payasam', name: 'Semiya payasam', price: 90, veg: true, code: 'DS04' }
    ] }
  ]
};
