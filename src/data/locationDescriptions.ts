/**
 * Ward-level and district-level descriptions for Vietnamese locations.
 * Ward entries come FIRST so the substring matcher picks more specific matches
 * before falling back to district-level descriptions.
 *
 * Keys are lowercase; both accented and unaccented forms are included.
 */

export const LOCATION_DESCRIPTIONS: Record<string, string> = {
  // ═══════════════════════════════════════════════════════════════
  //  HO CHI MINH CITY — WARD-LEVEL
  // ═══════════════════════════════════════════════════════════════

  // District 1 wards
  'bến nghé': 'Heart of District 1 with Nguyen Hue walking street, luxury hotels, and Saigon River promenade',
  'ben nghe': 'Heart of District 1 with Nguyen Hue walking street, luxury hotels, and Saigon River promenade',
  'bến thành': 'Iconic market area with street food, shopping, and the city\'s most famous landmark',
  'ben thanh': 'Iconic market area with street food, shopping, and the city\'s most famous landmark',
  'đa kao': 'Charming neighborhood near the zoo with French-era villas, quiet cafes, and tree-lined avenues',
  'da kao': 'Charming neighborhood near the zoo with French-era villas, quiet cafes, and tree-lined avenues',
  'nguyễn thái bình': 'Central business ward with office towers, Japanese restaurants, and easy metro access',
  'nguyen thai binh': 'Central business ward with office towers, Japanese restaurants, and easy metro access',
  'phạm ngũ lão': 'Backpacker quarter with budget hotels, rooftop bars, and lively international atmosphere',
  'pham ngu lao': 'Backpacker quarter with budget hotels, rooftop bars, and lively international atmosphere',
  'tân định': 'Quiet residential pocket in District 1 with the pink church, boutique shops, and local eateries',
  'tan dinh': 'Quiet residential pocket in District 1 with the pink church, boutique shops, and local eateries',
  'cô giang': 'Up-and-coming creative quarter with specialty coffee, art spaces, and affordable D1 living',
  'co giang': 'Up-and-coming creative quarter with specialty coffee, art spaces, and affordable D1 living',
  'cầu kho': 'Local neighborhood at the edge of District 1, close to District 4 with authentic street food',
  'cau kho': 'Local neighborhood at the edge of District 1, close to District 4 with authentic street food',
  'cầu ông lãnh': 'Riverside ward near Ben Thanh with wholesale markets and canal-side energy',
  'cau ong lanh': 'Riverside ward near Ben Thanh with wholesale markets and canal-side energy',
  'nguyễn cư trinh': 'Central ward between D1 and D5 with affordable dining and easy access to Chinatown',
  'nguyen cu trinh': 'Central ward between D1 and D5 with affordable dining and easy access to Chinatown',

  // District 2 / Thu Duc wards
  'thạnh mỹ lợi': 'Emerging riverside ward in Thu Duc with new apartments and waterfront developments',
  'thanh my loi': 'Emerging riverside ward in Thu Duc with new apartments and waterfront developments',
  'an khánh': 'Fast-growing area near Thao Dien with new condos and convenient bridge access to D1',
  'an khanh': 'Fast-growing area near Thao Dien with new condos and convenient bridge access to D1',
  'bình an': 'Quiet residential area between Thao Dien and Cat Lai with villa compounds and green spaces',
  'binh an': 'Quiet residential area between Thao Dien and Cat Lai with villa compounds and green spaces',
  'cát lái': 'Port-adjacent ward with affordable housing and rapid infrastructure development',
  'cat lai': 'Port-adjacent ward with affordable housing and rapid infrastructure development',
  'bình trưng đông': 'Growing residential zone near District 9 with new apartment complexes',
  'binh trung dong': 'Growing residential zone near District 9 with new apartment complexes',
  'bình trưng tây': 'Developing area with mix of villas and apartments, close to international schools',
  'binh trung tay': 'Developing area with mix of villas and apartments, close to international schools',

  // District 3 wards
  'võ thị sáu': 'Leafy ward with heritage buildings, Tao Dan Park, and vibrant cafe culture',
  'vo thi sau': 'Leafy ward with heritage buildings, Tao Dan Park, and vibrant cafe culture',

  // District 4 wards
  'bến vân đồn': 'Riverside strip with modern condos, river views, and quick access to District 1',
  'ben van don': 'Riverside strip with modern condos, river views, and quick access to District 1',

  // District 7 wards
  'phú mỹ hưng': 'Master-planned new town with international schools, parks, and upscale dining',
  'phu my hung': 'Master-planned new town with international schools, parks, and upscale dining',
  'tân phong': 'Modern ward in D7 anchored by Crescent Mall and Phu My Hung\'s central lake',
  'tan phong': 'Modern ward in D7 anchored by Crescent Mall and Phu My Hung\'s central lake',
  'tân phú': 'Family-friendly area with parks, schools, and growing amenities',
  'tan phu': 'Family-friendly area with parks, schools, and growing amenities',
  'tân hưng': 'Developing area in D7 with new high-rises and improving infrastructure',
  'tan hung': 'Developing area in D7 with new high-rises and improving infrastructure',
  'tân kiểng': 'Quiet residential ward in southern D7 with affordable housing options',
  'tan kieng': 'Quiet residential ward in southern D7 with affordable housing options',
  'tân thuận đông': 'Near the export processing zone with budget-friendly apartments',
  'tan thuan dong': 'Near the export processing zone with budget-friendly apartments',

  // Binh Thanh wards
  'hàng xanh': 'Major transit hub with easy access across HCMC, bustling street food, and local energy',
  'hang xanh': 'Major transit hub with easy access across HCMC, bustling street food, and local energy',

  // Phu Nhuan key areas
  'phường 1 phú nhuận': 'Lively area near Phan Xich Long food street with cafes and boutique shops',
  'phuong 1 phu nhuan': 'Lively area near Phan Xich Long food street with cafes and boutique shops',
  'phan xích long': 'Trendy food and cafe street in Phu Nhuan loved by young professionals',
  'phan xich long': 'Trendy food and cafe street in Phu Nhuan loved by young professionals',

  // Tan Binh near-airport wards
  'phường 2 tân bình': 'Convenient ward near the airport with diverse dining and hotel options',
  'phuong 2 tan binh': 'Convenient ward near the airport with diverse dining and hotel options',

  // Go Vap key areas
  'phạm văn đồng': 'Major boulevard corridor in Go Vap with new high-rises and modern amenities',
  'pham van dong': 'Major boulevard corridor in Go Vap with new high-rises and modern amenities',

  // ═══════════════════════════════════════════════════════════════
  //  HANOI — WARD-LEVEL
  // ═══════════════════════════════════════════════════════════════

  // Hoan Kiem wards
  'hàng bài': 'Central Hanoi street near the Opera House with upscale shops and French architecture',
  'hang bai': 'Central Hanoi street near the Opera House with upscale shops and French architecture',
  'hàng bông': 'Old Quarter ward with traditional silk shops, narrow streets, and artisan workshops',
  'hang bong': 'Old Quarter ward with traditional silk shops, narrow streets, and artisan workshops',
  'hàng gai': 'Famous silk street in the Old Quarter, popular with tourists for tailoring and souvenirs',
  'hang gai': 'Famous silk street in the Old Quarter, popular with tourists for tailoring and souvenirs',
  'phan chu trinh': 'Elegant district near the Opera House with colonial villas and embassy residences',
  'tràng tiền': 'Prestigious boulevard connecting Hoan Kiem Lake to the Opera House with luxury retail',
  'trang tien': 'Prestigious boulevard connecting Hoan Kiem Lake to the Opera House with luxury retail',
  'hàng trống': 'Cultural heart of Hanoi beside Hoan Kiem Lake with galleries and historic pagodas',
  'hang trong': 'Cultural heart of Hanoi beside Hoan Kiem Lake with galleries and historic pagodas',
  'lý thái tổ': 'Lakeside ward with scenic Hoan Kiem views, pedestrian streets, and weekend markets',
  'ly thai to': 'Lakeside ward with scenic Hoan Kiem views, pedestrian streets, and weekend markets',

  // Tay Ho wards
  'quảng an': 'Expat favorite on West Lake with flower villages, cafes, and serene lakeside walks',
  'quang an': 'Expat favorite on West Lake with flower villages, cafes, and serene lakeside walks',
  'xuân la': 'Growing residential area on West Lake\'s north shore with new apartments and lake views',
  'xuan la': 'Growing residential area on West Lake\'s north shore with new apartments and lake views',
  'nhật tân': 'Famous for its peach blossom gardens and scenic Red River bridge views',
  'nhat tan': 'Famous for its peach blossom gardens and scenic Red River bridge views',
  'tứ liên': 'Quiet peninsula on West Lake with village charm and riverside banana gardens',
  'tu lien': 'Quiet peninsula on West Lake with village charm and riverside banana gardens',
  'phú thượng': 'Northern Tay Ho ward with lakeside living, incense-making village, and local charm',
  'phu thuong': 'Northern Tay Ho ward with lakeside living, incense-making village, and local charm',

  // Ba Dinh wards
  'liễu giai': 'Upscale ward with Lotte Center, embassies, and premium high-rise apartments',
  'lieu giai': 'Upscale ward with Lotte Center, embassies, and premium high-rise apartments',
  'kim mã': 'Central business corridor with offices, Japanese restaurants, and convenient transit',
  'kim ma': 'Central business corridor with offices, Japanese restaurants, and convenient transit',
  'ngọc hà': 'Charming historical area near the Botanical Garden with colonial villas and quiet lanes',
  'ngoc ha': 'Charming historical area near the Botanical Garden with colonial villas and quiet lanes',
  'trúc bạch': 'Scenic lakeside ward with Truc Bach Lake, cafes, and French Quarter heritage',
  'truc bach': 'Scenic lakeside ward with Truc Bach Lake, cafes, and French Quarter heritage',
  'cống vị': 'Quiet diplomatic quarter near Ba Dinh Square with tree-lined streets',
  'cong vi': 'Quiet diplomatic quarter near Ba Dinh Square with tree-lined streets',

  // Cau Giay wards
  'dịch vọng': 'University area with young energy, affordable eateries, and co-working spaces',
  'dich vong': 'University area with young energy, affordable eateries, and co-working spaces',
  'dịch vọng hậu': 'Modern ward with Indochina Plaza, international restaurants, and office towers',
  'dich vong hau': 'Modern ward with Indochina Plaza, international restaurants, and office towers',
  'nghĩa đô': 'Residential ward in Cau Giay with local markets and convenient city access',
  'nghia do': 'Residential ward in Cau Giay with local markets and convenient city access',
  'nghĩa tân': 'Established neighborhood with vibrant street food, local schools, and community feel',
  'nghia tan': 'Established neighborhood with vibrant street food, local schools, and community feel',

  // Dong Da wards
  'cát linh': 'Transit-connected ward with Hanoi\'s first metro line and French-era architecture',
  'cat linh': 'Transit-connected ward with Hanoi\'s first metro line and French-era architecture',
  'khâm thiên': 'Famous food street with legendary pho, bun cha, and vibrant local nightlife',
  'kham thien': 'Famous food street with legendary pho, bun cha, and vibrant local nightlife',
  'ô chợ dừa': 'Busy commercial intersection with affordable apartments and street-food alleys',
  'o cho dua': 'Busy commercial intersection with affordable apartments and street-food alleys',
  'văn miếu': 'Heritage ward home to the Temple of Literature, Hanoi\'s most iconic cultural site',
  'van mieu': 'Heritage ward home to the Temple of Literature, Hanoi\'s most iconic cultural site',

  // Hai Ba Trung wards
  'bách khoa': 'University district anchored by Hanoi University of Science and Technology',
  'bach khoa': 'University district anchored by Hanoi University of Science and Technology',
  'thanh nhàn': 'Central residential ward with hospitals, local markets, and easy transit access',
  'thanh nhan': 'Central residential ward with hospitals, local markets, and easy transit access',
  'đồng nhân': 'Traditional neighborhood near Thien Quang Lake with local shops and eateries',
  'dong nhan': 'Traditional neighborhood near Thien Quang Lake with local shops and eateries',

  // Long Bien wards
  'ngọc thụy': 'Riverside ward with views of Long Bien Bridge, emerging cafes, and green spaces',
  'ngoc thuy': 'Riverside ward with views of Long Bien Bridge, emerging cafes, and green spaces',
  'phúc đồng': 'Developing area near Vinhomes Riverside with affordable new apartments',
  'phuc dong': 'Developing area near Vinhomes Riverside with affordable new apartments',
  'việt hưng': 'Modern suburban ward with large residential complexes and family amenities',
  'viet hung': 'Modern suburban ward with large residential complexes and family amenities',

  // ═══════════════════════════════════════════════════════════════
  //  DA NANG — WARD-LEVEL
  // ═══════════════════════════════════════════════════════════════

  // Hai Chau wards
  'hải châu 1': 'Downtown core near Han Market with shops, street food, and river promenade',
  'hai chau 1': 'Downtown core near Han Market with shops, street food, and river promenade',
  'hải châu 2': 'Southern downtown with local neighborhoods and easy bridge access to the beach',
  'hai chau 2': 'Southern downtown with local neighborhoods and easy bridge access to the beach',
  'thanh bình': 'Waterfront ward along the Han River with parks and sunset views',
  'thanh binh': 'Waterfront ward along the Han River with parks and sunset views',
  'thuận phước': 'Northern Hai Chau near the iconic Dragon Bridge with riverside dining',
  'thuan phuoc': 'Northern Hai Chau near the iconic Dragon Bridge with riverside dining',
  'hòa thuận tây': 'Quiet central ward with local charm, pagodas, and affordable living',
  'hoa thuan tay': 'Quiet central ward with local charm, pagodas, and affordable living',
  'hòa thuận đông': 'Growing residential area with new apartments near the city center',
  'hoa thuan dong': 'Growing residential area with new apartments near the city center',

  // Son Tra wards
  'an hải bắc': 'Popular expat area near My Khe Beach with restaurants and beach bars',
  'an hai bac': 'Popular expat area near My Khe Beach with restaurants and beach bars',
  'an hải đông': 'Beachside living with seafood restaurants and easy access to Son Tra Peninsula',
  'an hai dong': 'Beachside living with seafood restaurants and easy access to Son Tra Peninsula',
  'mân thái': 'Coastal ward with local fishing village character and Son Tra mountain backdrop',
  'man thai': 'Coastal ward with local fishing village character and Son Tra mountain backdrop',
  'phước mỹ': 'Prime My Khe Beach location — one of the world\'s most beautiful urban beaches',
  'phuoc my': 'Prime My Khe Beach location — one of the world\'s most beautiful urban beaches',
  'thọ quang': 'Fishing port ward with fresh seafood markets and Son Tra nature access',
  'tho quang': 'Fishing port ward with fresh seafood markets and Son Tra nature access',

  // Ngu Hanh Son wards
  'mỹ an': 'Resort-style beachfront living near luxury hotels and the Marble Mountains',
  'my an': 'Resort-style beachfront living near luxury hotels and the Marble Mountains',
  'khuê mỹ': 'Quiet coastal ward with beach access, new villas, and resort developments',
  'khue my': 'Quiet coastal ward with beach access, new villas, and resort developments',
  'hòa hải': 'Home to the Marble Mountains with artisan stone-carving villages and spiritual caves',
  'hoa hai': 'Home to the Marble Mountains with artisan stone-carving villages and spiritual caves',

  // ═══════════════════════════════════════════════════════════════
  //  DISTRICT-LEVEL (kept after wards for fallback matching)
  // ═══════════════════════════════════════════════════════════════

  // HCMC Districts
  'quận 1': 'Business hub with luxury shopping, fine dining, and vibrant nightlife',
  'district 1': 'Business hub with luxury shopping, fine dining, and vibrant nightlife',
  'd1': 'Business hub with luxury shopping, fine dining, and vibrant nightlife',
  'quận 2': 'Modern expat area with international schools and riverside living',
  'district 2': 'Modern expat area with international schools and riverside living',
  'd2': 'Modern expat area with international schools and riverside living',
  'quận 3': 'Local culture mix with cafes, street food, and affordable living',
  'district 3': 'Local culture mix with cafes, street food, and affordable living',
  'd3': 'Local culture mix with cafes, street food, and affordable living',
  'quận 4': 'Authentic local life with traditional markets and riverside views',
  'district 4': 'Authentic local life with traditional markets and riverside views',
  'd4': 'Authentic local life with traditional markets and riverside views',
  'quận 5': 'Chinatown district with rich heritage, temples, and bustling markets',
  'district 5': 'Chinatown district with rich heritage, temples, and bustling markets',
  'd5': 'Chinatown district with rich heritage, temples, and bustling markets',
  'quận 6': 'Traditional neighborhood with local markets and authentic cuisine',
  'district 6': 'Traditional neighborhood with local markets and authentic cuisine',
  'd6': 'Traditional neighborhood with local markets and authentic cuisine',
  'quận 7': 'Planned urban area popular with expats, near Phú Mỹ Hưng new town',
  'district 7': 'Planned urban area popular with expats, near Phú Mỹ Hưng new town',
  'd7': 'Planned urban area popular with expats, near Phú Mỹ Hưng new town',
  'quận 8': 'Riverside district with local charm and growing development',
  'district 8': 'Riverside district with local charm and growing development',
  'd8': 'Riverside district with local charm and growing development',
  'quận 9': 'Hi-tech park area with green spaces and modern developments',
  'district 9': 'Hi-tech park area with green spaces and modern developments',
  'd9': 'Hi-tech park area with green spaces and modern developments',
  'quận 10': 'Central district with diverse food scene and local markets',
  'district 10': 'Central district with diverse food scene and local markets',
  'd10': 'Central district with diverse food scene and local markets',
  'quận 11': 'Residential area with traditional markets and local eateries',
  'district 11': 'Residential area with traditional markets and local eateries',
  'd11': 'Residential area with traditional markets and local eateries',
  'quận 12': 'Suburban feel with parks, affordable housing, and growing infrastructure',
  'district 12': 'Suburban feel with parks, affordable housing, and growing infrastructure',
  'd12': 'Suburban feel with parks, affordable housing, and growing infrastructure',
  'bình thạnh': 'Trendy neighborhood with cafes, co-working spaces, and young professionals',
  'binh thanh': 'Trendy neighborhood with cafes, co-working spaces, and young professionals',
  'phú nhuận': 'Central residential area with great food streets and local charm',
  'phu nhuan': 'Central residential area with great food streets and local charm',
  'tân bình': 'Near the airport with diverse dining and bustling commercial streets',
  'tan binh': 'Near the airport with diverse dining and bustling commercial streets',
  // 'tân phú' / 'tan phu' already defined at ward level (D7) with a similar description
  'gò vấp': 'Lively residential district with markets and affordable living',
  'go vap': 'Lively residential district with markets and affordable living',
  'thủ đức': 'University town with tech parks, nature, and modern developments',
  'thu duc': 'University town with tech parks, nature, and modern developments',
  'bình tân': 'Industrial-residential mix with affordable options and local markets',
  'binh tan': 'Industrial-residential mix with affordable options and local markets',
  'nhà bè': 'Quiet suburban area with riverside charm south of the city',
  'nha be': 'Quiet suburban area with riverside charm south of the city',
  'thảo điền': 'Upscale expat enclave with trendy cafes, boutiques, and riverside villas',
  'thao dien': 'Upscale expat enclave with trendy cafes, boutiques, and riverside villas',
  'an phú': 'Modern residential area in Thu Duc with international schools and amenities',
  'an phu': 'Modern residential area in Thu Duc with international schools and amenities',
  'hồ chí minh': 'Vietnam\'s largest city — a dynamic metropolis of culture, commerce, and cuisine',
  'ho chi minh': 'Vietnam\'s largest city — a dynamic metropolis of culture, commerce, and cuisine',

  // Hanoi Districts
  'ba đình': 'Political center with historic sites, embassies, and tree-lined streets',
  'ba dinh': 'Political center with historic sites, embassies, and tree-lined streets',
  'hoàn kiếm': 'Old Quarter charm with Hoan Kiem Lake, heritage, and vibrant street life',
  'hoan kiem': 'Old Quarter charm with Hoan Kiem Lake, heritage, and vibrant street life',
  'đống đa': 'Cultural district with universities, temples, and local neighborhoods',
  'dong da': 'Cultural district with universities, temples, and local neighborhoods',
  'cầu giấy': 'Modern urban center with tech companies and young professionals',
  'cau giay': 'Modern urban center with tech companies and young professionals',
  'tây hồ': 'Lakeside expat hub with international restaurants and peaceful living',
  'tay ho': 'Lakeside expat hub with international restaurants and peaceful living',
  'hai bà trưng': 'Vibrant central district with local markets, street food, and French colonial charm',
  'hai ba trung': 'Vibrant central district with local markets, street food, and French colonial charm',
  'hoàng mai': 'Emerging residential area with affordable housing and growing infrastructure',
  'hoang mai': 'Emerging residential area with affordable housing and growing infrastructure',
  'thanh xuân': 'Bustling urban district with universities, shopping, and convenient transit',
  'thanh xuan': 'Bustling urban district with universities, shopping, and convenient transit',
  'bắc từ liêm': 'Modern northern district with new urban areas and green spaces',
  'bac tu liem': 'Modern northern district with new urban areas and green spaces',
  'nam từ liêm': 'Business district with modern high-rises and convention centers',
  'nam tu liem': 'Business district with modern high-rises and convention centers',
  'gia lâm': 'Suburban district east of Hanoi with traditional villages and riverside charm',
  'gia lam': 'Suburban district east of Hanoi with traditional villages and riverside charm',
  'long biên': 'Expanding district across the Red River with parks and new developments',
  'long bien': 'Expanding district across the Red River with parks and new developments',

  // Da Nang Districts
  'hải châu': 'Downtown Da Nang with Han River views and urban conveniences',
  'hai chau': 'Downtown Da Nang with Han River views and urban conveniences',
  'sơn trà': 'Beachside living near My Khe Beach and Son Tra Peninsula',
  'son tra': 'Beachside living near My Khe Beach and Son Tra Peninsula',
  'ngũ hành sơn': 'Coastal area near Marble Mountains with resort-style living',
  'ngu hanh son': 'Coastal area near Marble Mountains with resort-style living',
};
