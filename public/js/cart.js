const CART_KEY = "ag_cart_v1";

export function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const cart = raw ? JSON.parse(raw) : { items: [] };
    if (!cart.items) cart.items = [];
    return cart;
  } catch {
    return { items: [] };
  }
}

export function writeCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function addToCart(productId, qty = 1) {
  const cart = readCart();
  const existing = cart.items.find(i => i.productId === productId);
  if (existing) existing.qty += qty;
  else cart.items.push({ productId, qty });
  writeCart(cart);
  return cart;
}

export function updateQty(productId, qty) {
  const cart = readCart();
  const item = cart.items.find(i => i.productId === productId);
  if (!item) return cart;
  item.qty = qty;
  cart.items = cart.items.filter(i => i.qty > 0);
  writeCart(cart);
  return cart;
}

export function removeItem(productId) {
  const cart = readCart();
  cart.items = cart.items.filter(i => i.productId !== productId);
  writeCart(cart);
  return cart;
}

export function clearCart() {
  writeCart({ items: [] });
}

export function clearCart() {
  localStorage.setItem(CART_KEY, JSON.stringify({ items: [] }));
}
