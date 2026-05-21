const PRODUCTS = [
  { id: 1, name: 'Voyageur Parka', sub: 'Winter Collection', price: 349, oldPrice: 449, emoji: '🧥', badge: 'sale', rating: 4.8, reviews: 124, category: 'outerwear', desc: 'Engineered for Canadian winters, the Voyageur Parka features 800-fill goose down insulation and a water-resistant shell.', sizes: ['XS','S','M','L','XL','XXL'], colors: ['#1A1A18','#C8102E','#2D5016'], thumbBg: '#E8E5DC', extras: ['🧥','🧤','🧣'] },
  { id: 2, name: 'Algonquin Fleece', sub: 'Everyday Essentials', price: 129, emoji: '🦫', badge: 'new', rating: 4.6, reviews: 67, category: 'tops', desc: 'Inspired by the Algonquin wilderness, this 300-weight fleece is crafted from recycled fibres.', sizes: ['XS','S','M','L','XL'], colors: ['#2D5016','#6B6B68','#C8102E'], thumbBg: '#EAF0E1', extras: ['🧶','🧤','🎽'] },
  { id: 3, name: 'Rideau Wool Toque', sub: 'Accessories', price: 68, emoji: '🧢', badge: null, rating: 4.9, reviews: 203, category: 'accessories', desc: 'Hand-knit from 100% merino wool with a classic maple leaf intarsia pattern.', sizes: ['One Size'], colors: ['#C8102E','#1A1A18','#F4F1EA'], thumbBg: '#F5E6E9', extras: ['🧢','🧤','🧣'] },
  { id: 4, name: 'Shield Trail Boot', sub: 'Footwear', price: 229, oldPrice: 279, emoji: '🥾', badge: 'sale', rating: 4.7, reviews: 89, category: 'footwear', desc: 'Waterproof full-grain leather uppers with aggressive lug soles. Rated to -30°C.', sizes: ['7','8','9','10','11','12','13'], colors: ['#C5A028','#1A1A18','#6B6B68'], thumbBg: '#F7EDD0', extras: ['🥾','🧦','👟'] },
  { id: 5, name: 'Boreal Cargo Pant', sub: 'Bottoms', price: 159, emoji: '👖', badge: null, rating: 4.5, reviews: 52, category: 'bottoms', desc: 'Technical stretch canvas with DWR coating and deep cargo pockets.', sizes: ['28','30','32','34','36','38'], colors: ['#1A1A18','#C5A028','#2D5016'], thumbBg: '#E8E5DC', extras: ['👖','🧤','🎽'] },
  { id: 6, name: 'Maple Grove Flannel', sub: 'Tops', price: 95, emoji: '🎽', badge: 'new', rating: 4.7, reviews: 38, category: 'tops', desc: 'Heavyweight 100% organic cotton flannel brushed to perfection.', sizes: ['XS','S','M','L','XL','XXL'], colors: ['#C8102E','#1A1A18','#2D5016'], thumbBg: '#F5E6E9', extras: ['🎽','🧤','🧥'] },
  { id: 7, name: 'Tundra Down Vest', sub: 'Outerwear', price: 189, emoji: '🦺', badge: null, rating: 4.4, reviews: 74, category: 'outerwear', desc: 'Lightweight 600-fill down vest with a clean heritage silhouette.', sizes: ['XS','S','M','L','XL'], colors: ['#2D5016','#1A1A18','#C5A028'], thumbBg: '#EAF0E1', extras: ['🦺','🧥','🎽'] },
  { id: 8, name: 'Hudson Scarf', sub: 'Accessories', price: 78, emoji: '🧣', badge: null, rating: 5.0, reviews: 47, category: 'accessories', desc: 'A generous 200cm length in heritage tartan wool blend.', sizes: ['One Size'], colors: ['#C5A028','#C8102E','#1A1A18'], thumbBg: '#F7EDD0', extras: ['🧣','🧢','🧤'] },
];

const COLLECTIONS = [
  { id: 'outerwear', name: 'Outerwear', desc: 'Parkas, vests & shells for every forecast', emoji: '🧥', count: 24 },
  { id: 'tops', name: 'Tops & Fleece', desc: 'Flannels, fleeces & everyday favourites', emoji: '🎽', count: 18 },
  { id: 'bottoms', name: 'Bottoms', desc: 'Technical pants & heritage denim', emoji: '👖', count: 12 },
  { id: 'footwear', name: 'Footwear', desc: 'Boots, trail shoes & everyday soles', emoji: '🥾', count: 16 },
  { id: 'accessories', name: 'Accessories', desc: 'Toques, scarves, mitts & more', emoji: '🧢', count: 30 },
  { id: 'sale', name: 'Maple Deals', desc: 'Up to 40% off select styles', emoji: '🍁', count: 22 },
];

module.exports = { PRODUCTS, COLLECTIONS };
