'use strict';
// SAMPLE MENU for the Counter screen. Replace with the restaurant's real menu
// (later this comes from the RESTRO backend). Prices in rupees, before GST.
// veg: true / false shows as the green / red mark on each item card.
// Each category has its colour and its 3D food icon (Category grid, POS Counter Handoff); `modifiers` names the
// modifier groups its items offer (an item's own `modifiers` replaces its category's; [] for none).
// GST (taxRate) is charged on the bill as CGST and SGST, half each (Counter Update 6: CGST 2.5% + SGST 2.5%).
window.RestroMenu = {
  sample: true,
  currency: 'INR',
  taxRate: 0.05,
  taxLabel: 'GST 5%',
  // Modifier groups. kind: 'spice' shows amber on the order line, 'other' grey. A required group takes one choice, made
  // in the dish's pop-up as it is added (it can be changed but not cleared); the others take any number, or none.
  // price: added to the item's price (rupees), shown on the pill ("Extra gravy +₹40"). A group with mode 'set' (Counter
  // Update 7) sets the price instead: its choice's price is the dish's price (Half ₹200 / Full ₹340), add-ons on top.
  modifierGroups: [
    { id: 'portion', name: 'Portion', kind: 'other', required: true, mode: 'set', options: [
      { id: 'half', label: 'Half', price: 200 },
      { id: 'full', label: 'Full', price: 340 }
    ] },
    { id: 'spice', name: 'Spice level', kind: 'spice', required: true, options: [
      { id: 'less-spicy', label: 'Less spicy' },
      { id: 'medium-spicy', label: 'Medium spicy' },
      { id: 'extra-spicy', label: 'Extra spicy' }
    ] },
    { id: 'prep', name: 'Instructions', kind: 'other', options: [
      { id: 'no-onion', label: 'No onion' },
      { id: 'no-garlic', label: 'No garlic' },
      { id: 'less-oil', label: 'Less oil' },
      { id: 'make-dry', label: 'Make it dry' },
      { id: 'jain', label: 'Jain' }
    ] },
    { id: 'extras', name: 'Add-ons', kind: 'other', options: [
      { id: 'extra-gravy', label: 'Extra gravy', price: 40 },
      { id: 'extra-butter', label: 'Extra butter', price: 20 }
    ] },
    { id: 'drink', name: 'Instructions', kind: 'other', options: [
      { id: 'less-sugar', label: 'Less sugar' },
      { id: 'no-sugar', label: 'No sugar' },
      { id: 'no-ice', label: 'No ice' }
    ] }
  ],
  categories: [
    { id: 'starters', name: 'Starters', color: '#E11D48', icon: 'assets/counter/categories/poultry_leg_3d.png', modifiers: ['spice', 'prep'], items: [
      { id: 'paneer-tikka', name: 'Paneer tikka', price: 260, veg: true, code: 'ST01' },
      { id: 'chilli-paneer', name: 'Chilli paneer', price: 230, veg: true, code: 'CH04' },
      { id: 'gobi-65', name: 'Gobi 65', price: 190, veg: true, code: 'ST02' },
      { id: 'chicken-65', name: 'Chicken 65', price: 280, veg: false, code: 'ST04' },
      { id: 'chicken-lollipop', name: 'Chicken lollipop', price: 300, veg: false, code: 'ST06' },
      { id: 'fish-fry', name: 'Fish fingers', price: 320, veg: false, code: 'ST05' },
      { id: 'hara-bhara-kebab', name: 'Hara bhara kebab', price: 210, veg: true, code: 'ST08' },
      { id: 'tandoori-chicken-half', name: 'Tandoori chicken', price: 200, veg: false, code: 'ST09', modifiers: ['portion', 'spice'] },
      { id: 'crispy-corn', name: 'Crispy corn', price: 180, veg: true, code: 'ST10' },
      { id: 'spring-roll', name: 'Veg spring roll', price: 170, veg: true, code: 'ST03' },
      { id: 'chicken-tikka', name: 'Chicken tikka', price: 320, veg: false, code: 'ST11' },
      { id: 'paneer-65', name: 'Paneer 65', price: 240, veg: true, code: 'ST12' },
      { id: 'apollo-fish', name: 'Apollo fish', price: 340, veg: false, code: 'ST13' },
      { id: 'mushroom-pepper-fry', name: 'Mushroom pepper fry', price: 220, veg: true, code: 'ST14' },
      { id: 'chicken-malai-kebab', name: 'Chicken malai kebab', price: 340, veg: false, code: 'ST15' },
      { id: 'corn-cheese-balls', name: 'Corn cheese balls', price: 200, veg: true, code: 'ST16' },
      { id: 'mutton-seekh-kebab', name: 'Mutton seekh kebab', price: 380, veg: false, code: 'ST17' }
    ] },
    { id: 'biryani', name: 'Biryani & Rice', color: '#D97706', icon: 'assets/counter/categories/curry_rice_3d.png', items: [
      { id: 'veg-biryani', name: 'Veg biryani', price: 220, veg: true, code: 'BR01' },
      { id: 'chicken-biryani', name: 'Chicken biryani', price: 280, veg: false, code: 'BR02' },
      { id: 'mutton-biryani', name: 'Mutton biryani', price: 340, veg: false, code: 'BR03' },
      { id: 'veg-pulav', name: 'Veg pulav', price: 180, veg: true, code: 'BR04' },
      { id: 'jeera-rice', name: 'Jeera rice', price: 150, veg: true, code: 'BR05' },
      { id: 'curd-rice', name: 'Curd rice', price: 120, veg: true, code: 'BR06' },
      { id: 'egg-biryani', name: 'Egg biryani', price: 240, veg: false, code: 'BR07' },
      { id: 'prawn-biryani', name: 'Prawn biryani', price: 380, veg: false, code: 'BR08' },
      { id: 'lemon-rice', name: 'Lemon rice', price: 140, veg: true, code: 'BR09' }
    ] },
    { id: 'south', name: 'South Indian', color: '#EA580C', icon: 'assets/counter/categories/falafel_3d.png', items: [
      { id: 'masala-dosa', name: 'Masala dosa', price: 180, veg: true, code: 'SI01' },
      { id: 'plain-dosa', name: 'Plain dosa', price: 140, veg: true, code: 'SI02' },
      { id: 'rava-dosa', name: 'Rava dosa', price: 170, veg: true, code: 'SI03' },
      { id: 'idli', name: 'Idli (2 pcs)', price: 60, veg: true, code: 'SI04' },
      { id: 'medu-vada', name: 'Medu vada (2 pcs)', price: 70, veg: true, code: 'SI05' },
      { id: 'uttapam', name: 'Onion uttapam', price: 160, veg: true, code: 'SI06' },
      { id: 'pongal', name: 'Ven pongal', price: 120, veg: true, code: 'SI07' },
      { id: 'ghee-roast-dosa', name: 'Ghee roast dosa', price: 190, veg: true, code: 'SI08' },
      { id: 'mysore-masala-dosa', name: 'Mysore masala dosa', price: 200, veg: true, code: 'SI09' },
      { id: 'set-dosa', name: 'Set dosa', price: 150, veg: true, code: 'SI10' },
      { id: 'pesarattu', name: 'Pesarattu', price: 160, veg: true, code: 'SI11' },
      { id: 'upma', name: 'Upma', price: 90, veg: true, code: 'SI12' }
    ] },
    { id: 'north', name: 'North Indian', color: '#DC2626', icon: 'assets/counter/categories/shallow_pan_of_food_3d.png', modifiers: ['spice', 'prep', 'extras'], items: [
      { id: 'paneer-butter', name: 'Paneer butter masala', price: 260, veg: true, code: 'NI01' },
      { id: 'kadai-paneer', name: 'Kadai paneer', price: 270, veg: true, code: 'NI02' },
      { id: 'dal-makhani', name: 'Dal makhani', price: 220, veg: true, code: 'NI03' },
      { id: 'chana-masala', name: 'Chana masala', price: 190, veg: true, code: 'NI04' },
      { id: 'butter-chicken', name: 'Butter chicken', price: 320, veg: false, code: 'NI05' },
      { id: 'palak-paneer', name: 'Palak paneer', price: 260, veg: true, code: 'NI06' },
      { id: 'malai-kofta', name: 'Malai kofta', price: 270, veg: true, code: 'NI07' },
      { id: 'paneer-tikka-masala', name: 'Paneer tikka masala', price: 280, veg: true, code: 'NI08' },
      { id: 'mix-veg', name: 'Mix veg curry', price: 220, veg: true, code: 'NI09' },
      { id: 'aloo-gobi', name: 'Aloo gobi', price: 190, veg: true, code: 'NI10' },
      { id: 'dal-tadka', name: 'Dal tadka', price: 180, veg: true, code: 'NI11' },
      { id: 'rajma-masala', name: 'Rajma masala', price: 200, veg: true, code: 'NI12' },
      { id: 'chicken-tikka-masala', name: 'Chicken tikka masala', price: 340, veg: false, code: 'NI13' },
      { id: 'kadai-chicken', name: 'Kadai chicken', price: 330, veg: false, code: 'NI14' },
      { id: 'rogan-josh', name: 'Mutton rogan josh', price: 380, veg: false, code: 'NI15' },
      { id: 'egg-curry', name: 'Egg curry', price: 220, veg: false, code: 'NI16' }
    ] },
    { id: 'chinese', name: 'Indo-Chinese', color: '#0D9488', icon: 'assets/counter/categories/steaming_bowl_3d.png', modifiers: ['spice', 'prep'], items: [
      { id: 'veg-fried-rice', name: 'Veg fried rice', price: 190, veg: true, code: 'CH01' },
      { id: 'hakka-noodles', name: 'Hakka noodles', price: 190, veg: true, code: 'CH02' },
      { id: 'gobi-manchurian', name: 'Gobi manchurian', price: 180, veg: true, code: 'CH03' },
      { id: 'chicken-noodles', name: 'Chicken noodles', price: 220, veg: false, code: 'CH05' },
      { id: 'schezwan-fried-rice', name: 'Schezwan fried rice', price: 210, veg: true, code: 'CH06' },
      { id: 'chilli-chicken', name: 'Chilli chicken', price: 280, veg: false, code: 'CH07' },
      { id: 'veg-manchurian', name: 'Veg manchurian', price: 190, veg: true, code: 'CH08' },
      { id: 'chicken-fried-rice', name: 'Chicken fried rice', price: 230, veg: false, code: 'CH09' },
      { id: 'schezwan-noodles', name: 'Schezwan noodles', price: 210, veg: true, code: 'CH10' },
      { id: 'dragon-chicken', name: 'Dragon chicken', price: 300, veg: false, code: 'CH11' },
      { id: 'honey-chilli-potato', name: 'Honey chilli potato', price: 200, veg: true, code: 'CH12' }
    ] },
    { id: 'chaat', name: 'Chaat & Snacks', color: '#16A34A', icon: 'assets/counter/categories/dumpling_3d.png', items: [
      { id: 'pani-puri', name: 'Pani puri', price: 70, veg: true, code: 'CS01' },
      { id: 'bhel-puri', name: 'Bhel puri', price: 80, veg: true, code: 'CS02' },
      { id: 'pav-bhaji', name: 'Pav bhaji', price: 140, veg: true, code: 'CS03' },
      { id: 'samosa', name: 'Samosa (2 pcs)', price: 50, veg: true, code: 'CS04' },
      { id: 'vada-pav', name: 'Vada pav', price: 40, veg: true, code: 'CS05' },
      { id: 'dahi-puri', name: 'Dahi puri', price: 80, veg: true, code: 'CS06' },
      { id: 'sev-puri', name: 'Sev puri', price: 80, veg: true, code: 'CS07' },
      { id: 'aloo-tikki-chaat', name: 'Aloo tikki chaat', price: 100, veg: true, code: 'CS08' },
      { id: 'papdi-chaat', name: 'Papdi chaat', price: 90, veg: true, code: 'CS09' },
      { id: 'kachori', name: 'Kachori (2 pcs)', price: 50, veg: true, code: 'CS10' }
    ] },
    { id: 'breads', name: 'Breads', color: '#A16207', icon: 'assets/counter/categories/flatbread_3d.png', items: [
      { id: 'tandoori-roti', name: 'Tandoori roti', price: 30, veg: true, code: 'BD01' },
      { id: 'butter-naan', name: 'Butter naan', price: 50, veg: true, code: 'BD02' },
      { id: 'garlic-naan', name: 'Garlic naan', price: 60, veg: true, code: 'BD03' },
      { id: 'laccha-paratha', name: 'Laccha paratha', price: 55, veg: true, code: 'BD04' },
      { id: 'kulcha', name: 'Amritsari kulcha', price: 70, veg: true, code: 'BD05' },
      { id: 'plain-naan', name: 'Plain naan', price: 40, veg: true, code: 'BD06' },
      { id: 'rumali-roti', name: 'Rumali roti', price: 35, veg: true, code: 'BD07' }
    ] },
    { id: 'desserts', name: 'Desserts', color: '#7C3AED', icon: 'assets/counter/categories/ice_cream_3d.png', items: [
      { id: 'gulab-jamun', name: 'Gulab jamun (2 pcs)', price: 80, veg: true, code: 'DS01' },
      { id: 'rasmalai', name: 'Rasmalai', price: 110, veg: true, code: 'DS02' },
      { id: 'kulfi', name: 'Malai kulfi', price: 90, veg: true, code: 'DS03' },
      { id: 'payasam', name: 'Semiya payasam', price: 90, veg: true, code: 'DS04' },
      { id: 'gajar-halwa', name: 'Gajar halwa', price: 110, veg: true, code: 'DS05' },
      { id: 'double-ka-meetha', name: 'Double ka meetha', price: 120, veg: true, code: 'DS06' },
      { id: 'brownie-ice-cream', name: 'Brownie with ice cream', price: 160, veg: true, code: 'DS07' },
      { id: 'fruit-custard', name: 'Fruit custard', price: 100, veg: true, code: 'DS08' }
    ] },
    { id: 'beverages', name: 'Beverages', color: '#2563EB', icon: 'assets/counter/categories/hot_beverage_3d.png', modifiers: ['drink'], items: [
      { id: 'filter-coffee', name: 'Filter coffee', price: 60, veg: true, code: 'BV01' },
      { id: 'masala-chai', name: 'Masala chai', price: 40, veg: true, code: 'BV02' },
      { id: 'sweet-lassi', name: 'Sweet lassi', price: 90, veg: true, code: 'BV03' },
      { id: 'mango-lassi', name: 'Mango lassi', price: 110, veg: true, code: 'BV04' },
      { id: 'buttermilk', name: 'Buttermilk', price: 50, veg: true, code: 'BV05' },
      { id: 'lime-soda', name: 'Fresh lime soda', price: 70, veg: true, code: 'BV06' },
      { id: 'cold-coffee', name: 'Cold coffee', price: 120, veg: true, code: 'BV07' },
      { id: 'lemon-iced-tea', name: 'Lemon iced tea', price: 90, veg: true, code: 'BV08' },
      { id: 'badam-milk', name: 'Badam milk', price: 90, veg: true, code: 'BV09' },
      { id: 'rose-milk', name: 'Rose milk', price: 80, veg: true, code: 'BV10' },
      { id: 'jaljeera', name: 'Jaljeera', price: 60, veg: true, code: 'BV11' },
      { id: 'mineral-water', name: 'Mineral water', price: 30, veg: true, code: 'BV12' },
      { id: 'soft-drink', name: 'Soft drink', price: 50, veg: true, code: 'BV13' }
    ] },
    { id: 'tandoor', name: 'Tandoor', color: '#DC2626', icon: 'assets/counter/categories/poultry_leg_3d.png', modifiers: ['spice', 'prep'], items: [
      { id: 'tandoori-chicken-full', name: 'Tandoori chicken (full)', price: 620, veg: false, code: 'TD01' },
      { id: 'reshmi-kebab', name: 'Chicken reshmi kebab', price: 340, veg: false, code: 'TD02' },
      { id: 'tangdi-kebab', name: 'Tangdi kebab', price: 360, veg: false, code: 'TD03' },
      { id: 'fish-tikka', name: 'Fish tikka', price: 380, veg: false, code: 'TD04' },
      { id: 'tandoori-prawns', name: 'Tandoori prawns', price: 480, veg: false, code: 'TD05' },
      { id: 'paneer-malai-tikka', name: 'Paneer malai tikka', price: 280, veg: true, code: 'TD06' },
      { id: 'tandoori-mushroom', name: 'Tandoori mushroom', price: 240, veg: true, code: 'TD07' },
      { id: 'tandoori-aloo', name: 'Tandoori aloo', price: 220, veg: true, code: 'TD08' },
      { id: 'achari-paneer-tikka', name: 'Achari paneer tikka', price: 280, veg: true, code: 'TD09' },
      { id: 'veg-seekh-kebab', name: 'Veg seekh kebab', price: 240, veg: true, code: 'TD10' }
    ] },
    { id: 'soups', name: 'Soups', color: '#0D9488', icon: 'assets/counter/categories/pot_of_food_3d.png', items: [
      { id: 'tomato-soup', name: 'Tomato soup', price: 120, veg: true, code: 'SP01' },
      { id: 'sweet-corn-soup', name: 'Sweet corn soup', price: 130, veg: true, code: 'SP02' },
      { id: 'hot-sour-soup', name: 'Hot & sour soup', price: 130, veg: true, code: 'SP03' },
      { id: 'manchow-soup', name: 'Manchow soup', price: 140, veg: true, code: 'SP04' },
      { id: 'chicken-corn-soup', name: 'Chicken sweet corn soup', price: 160, veg: false, code: 'SP05' },
      { id: 'mutton-paya', name: 'Mutton paya soup', price: 220, veg: false, code: 'SP06' }
    ] },
    { id: 'salads', name: 'Salads', color: '#16A34A', icon: 'assets/counter/categories/green_salad_3d.png', items: [
      { id: 'green-salad', name: 'Green salad', price: 90, veg: true, code: 'SL01' },
      { id: 'kachumber', name: 'Kachumber salad', price: 100, veg: true, code: 'SL02' },
      { id: 'russian-salad', name: 'Russian salad', price: 140, veg: true, code: 'SL03' },
      { id: 'sprouts-salad', name: 'Sprouts salad', price: 110, veg: true, code: 'SL04' },
      { id: 'chicken-salad', name: 'Chicken salad', price: 220, veg: false, code: 'SL05' }
    ] },
    { id: 'rice-bowls', name: 'Rice bowls', color: '#A16207', icon: 'assets/counter/categories/cooked_rice_3d.png', modifiers: ['spice', 'prep'], items: [
      { id: 'rajma-chawal', name: 'Rajma chawal', price: 180, veg: true, code: 'RB01' },
      { id: 'dal-khichdi', name: 'Dal khichdi', price: 170, veg: true, code: 'RB02' },
      { id: 'paneer-rice-bowl', name: 'Paneer butter masala bowl', price: 220, veg: true, code: 'RB03' },
      { id: 'chole-chawal', name: 'Chole chawal', price: 180, veg: true, code: 'RB04' },
      { id: 'butter-chicken-bowl', name: 'Butter chicken bowl', price: 260, veg: false, code: 'RB05' },
      { id: 'chicken-curry-bowl', name: 'Chicken curry bowl', price: 240, veg: false, code: 'RB06' },
      { id: 'egg-curry-bowl', name: 'Egg curry bowl', price: 200, veg: false, code: 'RB07' },
      { id: 'chilli-chicken-bowl', name: 'Chilli chicken bowl', price: 250, veg: false, code: 'RB08' }
    ] },
    { id: 'thalis', name: 'Thalis', color: '#7C3AED', icon: 'assets/counter/categories/fork_and_knife_with_plate_3d.png', items: [
      { id: 'veg-thali', name: 'Veg thali', price: 250, veg: true, code: 'TH01' },
      { id: 'north-thali', name: 'North Indian thali', price: 300, veg: true, code: 'TH02' },
      { id: 'south-thali', name: 'South Indian thali', price: 280, veg: true, code: 'TH03' },
      { id: 'non-veg-thali', name: 'Non-veg thali', price: 350, veg: false, code: 'TH04' }
    ] },
    { id: 'kids', name: 'Kids menu', color: '#2563EB', icon: 'assets/counter/categories/french_fries_3d.png', items: [
      { id: 'mini-cheese-dosa', name: 'Mini cheese dosa', price: 120, veg: true, code: 'KD01' },
      { id: 'french-fries', name: 'French fries', price: 110, veg: true, code: 'KD02' },
      { id: 'cheese-sandwich', name: 'Veg cheese sandwich', price: 130, veg: true, code: 'KD03' },
      { id: 'mini-pizza', name: 'Mini veg pizza', price: 150, veg: true, code: 'KD04' },
      { id: 'chicken-nuggets', name: 'Chicken nuggets', price: 180, veg: false, code: 'KD05' },
      { id: 'mac-cheese', name: 'Mac and cheese', price: 160, veg: true, code: 'KD06' }
    ] },
    { id: 'combos', name: 'Combos', color: '#E11D48', icon: 'assets/counter/categories/bento_box_3d.png', items: [
      { id: 'paneer-meal', name: 'Paneer meal', price: 299, veg: true, code: 'CB01' },
      { id: 'biryani-combo', name: 'Chicken biryani combo', price: 349, veg: false, code: 'CB02' },
      { id: 'dosa-coffee', name: 'Dosa and coffee', price: 199, veg: true, code: 'CB03' },
      { id: 'chole-bhature', name: 'Chole bhature combo', price: 199, veg: true, code: 'CB04' },
      { id: 'rice-manchurian', name: 'Fried rice and manchurian', price: 279, veg: true, code: 'CB05' },
      { id: 'noodles-chilli-chicken', name: 'Noodles and chilli chicken', price: 379, veg: false, code: 'CB06' },
      { id: 'family-veg', name: 'Family veg combo', price: 799, veg: true, code: 'CB07' }
    ] },
    { id: 'mocktails', name: 'Mocktails', color: '#D97706', icon: 'assets/counter/categories/tropical_drink_3d.png', modifiers: ['drink'], items: [
      { id: 'virgin-mojito', name: 'Virgin mojito', price: 150, veg: true, code: 'MK01' },
      { id: 'blue-lagoon', name: 'Blue lagoon', price: 160, veg: true, code: 'MK02' },
      { id: 'fruit-punch', name: 'Fruit punch', price: 160, veg: true, code: 'MK03' },
      { id: 'watermelon-cooler', name: 'Watermelon cooler', price: 140, veg: true, code: 'MK04' },
      { id: 'kala-khatta', name: 'Kala khatta', price: 120, veg: true, code: 'MK05' },
      { id: 'mint-lemonade', name: 'Mint lemonade', price: 120, veg: true, code: 'MK06' },
      { id: 'virgin-pina-colada', name: 'Virgin pina colada', price: 180, veg: true, code: 'MK07' },
      { id: 'strawberry-cooler', name: 'Strawberry cooler', price: 160, veg: true, code: 'MK08' },
      { id: 'ginger-lime-fizz', name: 'Ginger lime fizz', price: 140, veg: true, code: 'MK09' }
    ] },
    { id: 'ice-creams', name: 'Ice creams', color: '#EA580C', icon: 'assets/counter/categories/soft_ice_cream_3d.png', items: [
      { id: 'vanilla-scoop', name: 'Vanilla', price: 80, veg: true, code: 'IC01' },
      { id: 'chocolate-scoop', name: 'Chocolate', price: 90, veg: true, code: 'IC02' },
      { id: 'butterscotch-scoop', name: 'Butterscotch', price: 90, veg: true, code: 'IC03' },
      { id: 'strawberry-scoop', name: 'Strawberry', price: 90, veg: true, code: 'IC04' },
      { id: 'mango-scoop', name: 'Mango', price: 100, veg: true, code: 'IC05' },
      { id: 'kesar-pista', name: 'Kesar pista', price: 110, veg: true, code: 'IC06' },
      { id: 'hot-fudge-sundae', name: 'Hot fudge sundae', price: 180, veg: true, code: 'IC07' },
      { id: 'brownie-sundae', name: 'Brownie sundae', price: 190, veg: true, code: 'IC08' }
    ] },
    { id: 'shakes', name: 'Shakes', color: '#DC2626', icon: 'assets/counter/categories/cup_with_straw_3d.png', modifiers: ['drink'], items: [
      { id: 'chocolate-shake', name: 'Chocolate shake', price: 150, veg: true, code: 'SK01' },
      { id: 'strawberry-shake', name: 'Strawberry shake', price: 150, veg: true, code: 'SK02' },
      { id: 'mango-shake', name: 'Mango shake', price: 150, veg: true, code: 'SK03' },
      { id: 'cookie-shake', name: 'Cookie crumble shake', price: 170, veg: true, code: 'SK04' },
      { id: 'banana-shake', name: 'Banana shake', price: 130, veg: true, code: 'SK05' },
      { id: 'butterscotch-shake', name: 'Butterscotch shake', price: 160, veg: true, code: 'SK06' }
    ] }
  ]
};
