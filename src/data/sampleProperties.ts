import { Apartment } from '@/types';

export const sampleProperties: Apartment[] = [
  {
    id: '1',
    images: [
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop'
    ],
    title: 'Modern Sky Loft',
    location: 'District 1, Ho Chi Minh City',
    price: 25000000,
    size: '85m²',
    vibe: 'Modern Minimalist',
    description: 'Experience urban luxury in this stunning sky-high loft featuring floor-to-ceiling windows that frame the bustling cityscape of District 1. The open-plan design seamlessly blends living, dining, and workspace areas, perfect for the modern professional. Premium hardwood floors complement the clean lines and neutral palette, while the gourmet kitchen boasts stainless steel appliances and marble countertops. The master bedroom offers a private sanctuary with city views, ideal for unwinding after exploring the vibrant street food scene and business districts just steps away. This lifestyle suits ambitious professionals who thrive in the heart of the action, enjoying morning coffee with skyscraper views and evening walks through historic landmarks.',
    highlights: ['City skyline views', 'Premium hardwood floors', 'Gourmet kitchen', 'Floor-to-ceiling windows', 'Open-plan design', 'Walking distance to Ben Thanh Market'],
    realtor: {
      id: 'realtor1',
      name: 'Nguyen Minh Duc',
      phone: '+84 901 234 567',
      email: 'duc.nguyen@realty.vn'
    }
  },
  {
    id: '2',
    images: [
      'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1567767292278-a4f21aa2d36e?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&h=600&fit=crop'
    ],
    title: 'Artist\'s Creative Haven',
    location: 'District 3, Ho Chi Minh City',
    price: 18000000,
    size: '70m²',
    vibe: 'Creative Haven',
    description: 'Unleash your creativity in this inspiring artist\'s loft nestled in the cultural heart of District 3. The space features exposed brick walls, industrial lighting, and a dedicated studio area with north-facing windows for perfect natural light. Vintage wooden floors and eclectic furnishings create an atmosphere that sparks innovation and artistic expression. The open kitchen encourages social cooking sessions, while the cozy reading nook by the window offers a peaceful retreat. Located minutes from art galleries, independent cafes, and creative workshops, this space attracts artists, writers, designers, and free spirits who value authentic experiences over luxury amenities. The neighborhood buzzes with creative energy, offering late-night inspiration and community connections.',
    highlights: ['Exposed brick walls', 'Artist studio space', 'Natural north light', 'Vintage hardwood', 'Gallery district location', 'Creative community'],
    realtor: {
      id: 'realtor2',
      name: 'Tran Thi Mai',
      phone: '+84 902 345 678',
      email: 'mai.tran@homescape.vn'
    }
  },
  {
    id: '3',
    images: [
      'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1556020685-ae41abfc9365?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1574362848149-11496d93a7c7?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1560185893-a55cbc8c57e8?w=800&h=600&fit=crop'
    ],
    title: 'Family Garden Oasis',
    location: 'District 2, Ho Chi Minh City',
    price: 22000000,
    size: '120m²',
    vibe: 'Cozy Traditional',
    description: 'Discover the perfect blend of traditional Vietnamese charm and family comfort in this spacious garden home. The property features a private courtyard garden where children can play safely while parents tend to herb gardens and enjoy morning tea. Traditional wooden elements mix beautifully with modern conveniences, including a family-sized kitchen with ample storage and a formal dining area perfect for multi-generational gatherings. Three bedrooms provide comfortable spaces for the whole family, while the living area opens to the garden through sliding doors. The neighborhood offers excellent schools, family-friendly parks, and traditional markets where you can source fresh ingredients for home cooking. This lifestyle suits families who value connection to nature, community bonds, and preserving cultural traditions while enjoying modern comforts.',
    highlights: ['Private garden courtyard', 'Traditional wooden details', 'Family-sized kitchen', 'Three bedrooms', 'Near excellent schools', 'Community parks'],
    realtor: {
      id: 'realtor3',
      name: 'Le Van Hoa',
      phone: '+84 903 456 789',
      email: 'hoa.le@familyhomes.vn'
    }
  },
  {
    id: '4',
    images: [
      'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1576941089067-2de3e9f14bff?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1599420186946-7b6fb7995c44?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1600585154524-16471cd6f754?w=800&h=600&fit=crop'
    ],
    title: 'Urban Sanctuary Apartment',
    location: 'Binh Thanh District, Ho Chi Minh City',
    price: 19500000,
    size: '65m²',
    vibe: 'Urban Sanctuary',
    description: 'Escape the city bustle in this serene urban sanctuary located in the vibrant Binh Thanh District. The apartment features a minimalist design with clean lines, neutral colors, and natural materials that create a calming atmosphere. Floor-to-ceiling windows offer panoramic city views, while blackout curtains ensure restful sleep. The open-plan living area is perfect for entertaining guests or relaxing after a long day. The modern kitchen is equipped with high-end appliances and ample counter space. The building offers a rooftop terrace with a swimming pool and BBQ area, perfect for enjoying the sunset. This lifestyle suits urban professionals who seek a balance between city excitement and peaceful retreat, enjoying morning yoga sessions with city views and evening cocktails on the rooftop.',
    highlights: ['Rooftop pool', 'City views', 'Modern kitchen', 'Balcony', 'Close to city center', 'Gym access'],
    realtor: {
      id: 'realtor4',
      name: 'Pham Thanh Tung',
      phone: '+84 904 567 890',
      email: 'tung.pham@urbanliving.vn'
    }
  },
  {
    id: '5',
    images: [
      'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1541347659-72298477497a?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1540518614846-7e64c4a2d58b?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1549294413-26f195200c1c?w=800&h=600&fit=crop'
    ],
    title: 'Industrial Chic Loft',
    location: 'District 4, Ho Chi Minh City',
    price: 17000000,
    size: '55m²',
    vibe: 'Industrial Chic',
    description: 'Embrace the raw beauty of industrial design in this chic loft located in the up-and-coming District 4. The space features exposed concrete walls, high ceilings, and large windows that flood the space with natural light. The open-plan living area is perfect for entertaining guests or working from home. The modern kitchen is equipped with stainless steel appliances and a breakfast bar. The bedroom is separated from the living area by a sliding door, offering privacy and quiet. The building offers a communal workspace and a rooftop terrace with city views. This lifestyle suits young professionals and creatives who appreciate minimalist design, urban exploration, and community connections, enjoying collaborative work sessions and rooftop gatherings.',
    highlights: ['Exposed concrete', 'High ceilings', 'Rooftop terrace', 'Communal workspace', 'Close to cafes', 'Pet-friendly'],
    realtor: {
      id: 'realtor5',
      name: 'Hoang Thu Trang',
      phone: '+84 905 678 901',
      email: 'trang.hoang@loftliving.vn'
    }
  },
  {
    id: '6',
    images: [
      'https://images.unsplash.com/photo-1560185062-94ca5c9ee695?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1572145384045-39567417c9ea?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1571458264459-4f234590a996?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1583608225688-86e3945973ff?w=800&h=600&fit=crop'
    ],
    title: 'Bohemian Eclectic Apartment',
    location: 'Phu Nhuan District, Ho Chi Minh City',
    price: 16000000,
    size: '60m²',
    vibe: 'Bohemian Eclectic',
    description: 'Immerse yourself in a world of color and creativity in this bohemian eclectic apartment located in the charming Phu Nhuan District. The space features a mix of vintage furniture, colorful textiles, and unique artwork that create a vibrant and inviting atmosphere. The open-plan living area is perfect for hosting friends or relaxing with a good book. The kitchen is equipped with all the essentials for cooking delicious meals. The bedroom is a cozy retreat with a comfortable bed and plenty of storage space. The balcony offers a view of the surrounding neighborhood. This lifestyle suits free spirits and art lovers who appreciate unique design, cultural experiences, and community connections, enjoying flea market finds and impromptu jam sessions.',
    highlights: ['Vintage furniture', 'Colorful textiles', 'Unique artwork', 'Balcony', 'Close to markets', 'Plant-filled'],
    realtor: {
      id: 'realtor6',
      name: 'Do Thi Anh',
      phone: '+84 906 789 012',
      email: 'anh.do@bohemianhomes.vn'
    }
  },
  {
    id: '7',
    images: [
      'https://images.unsplash.com/photo-1598989985459-78c5119ef473?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1616587792454-0b99f95ff919?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1618224482960-939101674041?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1623286865937-37b3d2354b24?w=800&h=600&fit=crop'
    ],
    title: 'Zen Retreat Studio',
    location: 'Go Vap District, Ho Chi Minh City',
    price: 15000000,
    size: '45m²',
    vibe: 'Zen Retreat',
    description: 'Find inner peace in this tranquil Zen retreat studio located in the quiet Go Vap District. The space features a minimalist design with natural materials, soft colors, and calming textures that create a serene atmosphere. The open-plan living area is perfect for meditation, yoga, or simply relaxing. The kitchen is equipped with all the essentials for preparing healthy meals. The balcony offers a view of the surrounding greenery. This lifestyle suits mindful individuals who seek a peaceful and balanced life, enjoying morning meditation sessions and evening walks in nature.',
    highlights: ['Minimalist design', 'Natural materials', 'Balcony', 'Close to parks', 'Quiet neighborhood', 'Meditation space'],
    realtor: {
      id: 'realtor7',
      name: 'Bui Xuan Mai',
      phone: '+84 907 890 123',
      email: 'mai.bui@zenliving.vn'
    }
  }
];
