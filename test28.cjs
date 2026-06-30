const regex = /housingsgn\.com\/properties\/[^\/\?#]+/i;
console.log(regex.test('https://housingsgn.com/apartment-for-rent-in-one-verandah-thu-duc'));
console.log(regex.test('https://housingsgn.com/properties/td02369-2br-river-view'));
