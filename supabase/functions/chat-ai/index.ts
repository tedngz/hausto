import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { Redis } from "https://esm.sh/@upstash/redis@latest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Upstash Redis client
const redis = new Redis({
  url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
  token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
});

// ========== LOCATION KNOWLEDGE BASE ==========
// Sub-districts and wards for each main district
const HCM_SUBDISTRICTS: Record<string, string[]> = {
  'district 1': ['da kao', 'đa kao', 'dakao', 'ben nghe', 'bến nghé', 'ben thanh', 'bến thành', 
                 'nguyen thai binh', 'nguyễn thái bình', 'pham ngu lao', 'phạm ngũ lão', 
                 'co giang', 'cô giang', 'cau ong lanh', 'cầu ông lãnh', 'nguyen cu trinh', 'nguyễn cư trinh',
                 'tan dinh', 'tân định', 'cau kho', 'cầu kho'],
  'district 2': ['thao dien', 'thảo điền', 'an phu', 'an phú', 'thu thiem', 'thủ thiêm',
                 'cat lai', 'cát lái', 'thanh my loi', 'thạnh mỹ lợi', 'binh an', 'bình an',
                 'binh khanh', 'bình khánh', 'binh trung dong', 'bình trưng đông', 
                 'binh trung tay', 'bình trưng tây', 'an khanh', 'an khánh', 'an loi dong', 'an lợi đông'],
  'district 3': ['vo thi sau', 'võ thị sáu', 'phuong 1', 'phuong 2', 'phuong 3', 'phuong 4', 'phuong 5',
                 'phuong 6', 'phuong 7', 'phuong 8', 'phuong 9', 'phuong 10', 'phuong 11', 'phuong 12', 'phuong 13', 'phuong 14'],
  'district 4': ['phuong 1', 'phuong 2', 'phuong 3', 'phuong 4', 'phuong 5', 'phuong 6', 
                 'phuong 8', 'phuong 9', 'phuong 10', 'phuong 12', 'phuong 13', 'phuong 14', 'phuong 15', 'phuong 16', 'phuong 18'],
  'district 7': ['phu my hung', 'phú mỹ hưng', 'tan phu', 'tân phú', 'tan phong', 'tân phong',
                 'tan hung', 'tân hưng', 'tan kieng', 'tân kiểng', 'tan quy', 'tân quy',
                 'phu thuan', 'phú thuận', 'tan thuan dong', 'tân thuận đông', 'tan thuan tay', 'tân thuận tây',
                 'binh thuan', 'bình thuận', 'phu my', 'phú mỹ'],
  'binh thanh': ['thanh da', 'thanh đa', 'binh quoi', 'bình quới', 'phuong 22', 'phuong 24', 'phuong 25', 
                  'phuong 26', 'phuong 27', 'phuong 28', 'hang xanh', 'hàng xanh', 'van thanh', 'văn thánh',
                  'phuong 1', 'phuong 2', 'phuong 3', 'phuong 5', 'phuong 6', 'phuong 7', 'phuong 11', 'phuong 12', 
                  'phuong 13', 'phuong 14', 'phuong 15', 'phuong 17', 'phuong 19', 'phuong 21'],
  'phu nhuan': ['phuong 1', 'phuong 2', 'phuong 3', 'phuong 4', 'phuong 5', 'phuong 7', 'phuong 8', 
                'phuong 9', 'phuong 10', 'phuong 11', 'phuong 13', 'phuong 15', 'phuong 17'],
  'thu duc': ['hiep binh chanh', 'hiệp bình chánh', 'hiep binh phuoc', 'hiệp bình phước',
              'linh dong', 'linh đông', 'linh tay', 'linh tây', 'linh chieu', 'linh chiểu',
              'linh trung', 'linh xuong', 'tam binh', 'tam bình', 'tam phu', 'tam phú',
              'truong tho', 'trường thọ', 'binh chieu', 'bình chiểu', 'binh tho', 'bình thọ'],
  'tan binh': ['phuong 1', 'phuong 2', 'phuong 3', 'phuong 4', 'phuong 5', 'phuong 6', 'phuong 7', 
               'phuong 8', 'phuong 9', 'phuong 10', 'phuong 11', 'phuong 12', 'phuong 13', 'phuong 14', 'phuong 15'],
  'go vap': ['phuong 1', 'phuong 3', 'phuong 4', 'phuong 5', 'phuong 6', 'phuong 7', 'phuong 8', 
             'phuong 9', 'phuong 10', 'phuong 11', 'phuong 12', 'phuong 13', 'phuong 14', 'phuong 15', 'phuong 16', 'phuong 17'],
};

const HANOI_SUBDISTRICTS: Record<string, string[]> = {
  'ba dinh': ['cong vi', 'cống vị', 'dien bien', 'điện biên', 'doi can', 'đội cấn', 'giang vo', 'giảng võ',
              'kim ma', 'kim mã', 'lieu giai', 'liễu giai', 'ngoc ha', 'ngọc hà', 'ngoc khanh', 'ngọc khánh',
              'nguyen trung truc', 'nguyễn trung trực', 'phuc xa', 'phúc xá', 'quan thanh', 'quán thánh',
              'thanh cong', 'thành công', 'truc bach', 'trúc bạch', 'vinh phuc', 'vĩnh phúc'],
  'hoan kiem': ['hang bac', 'hàng bạc', 'hang bo', 'hàng bồ', 'hang bong', 'hàng bông', 'hang buom', 'hàng buồm',
                'hang dao', 'hàng đào', 'hang gai', 'hàng gai', 'hang ma', 'hàng mã', 'hang trong', 'hàng trống',
                'cua dong', 'cửa đông', 'cua nam', 'cửa nam', 'dong xuan', 'đồng xuân', 'ly thai to', 'lý thái tổ',
                'phan chu trinh', 'phan chu trinh', 'trang tien', 'tràng tiền', 'tran hung dao', 'trần hưng đạo'],
  'dong da': ['cat linh', 'cát linh', 'hang bot', 'hàng bột', 'kim lien', 'kim liên', 'kham thien', 'khâm thiên',
              'lang ha', 'láng hạ', 'lang thuong', 'láng thượng', 'nam dong', 'nam đồng', 'o cho dua', 'ô chợ dừa',
              'phuong lien', 'phương liên', 'phuong mai', 'phương mai', 'quang trung', 'quang trung',
              'quoc tu giam', 'quốc tử giám', 'tho quan', 'thổ quan', 'trung liet', 'trung liệt', 
              'trung phung', 'trung phụng', 'trung tu', 'trung tự', 'van chuong', 'văn chương', 'van mieu', 'văn miếu'],
  'cau giay': ['dich vong', 'dịch vọng', 'dich vong hau', 'dịch vọng hậu', 'mai dich', 'mai dịch',
               'nghia do', 'nghĩa đô', 'nghia tan', 'nghĩa tân', 'quan hoa', 'quan hoa', 
               'trung hoa', 'trung hòa', 'yen hoa', 'yên hòa'],
  'tay ho': ['buoi', 'bưởi', 'nhat tan', 'nhật tân', 'phu thuong', 'phú thượng', 'quang an', 'quảng an',
             'thuy khue', 'thụy khuê', 'tu lien', 'tứ liên', 'xuan la', 'xuân la', 'yen phu', 'yên phụ'],
  'hai ba trung': ['bach dang', 'bạch đằng', 'bach khoa', 'bách khoa', 'bui thi xuan', 'bùi thị xuân',
                   'cau den', 'cầu dền', 'dong mac', 'đống mác', 'dong nhan', 'đồng nhân', 'dong tam', 'đồng tâm',
                   'le dai hanh', 'lê đại hành', 'minh khai', 'minh khai', 'nguyen du', 'nguyễn du',
                   'pho hue', 'phố huế', 'thanh luong', 'thanh lương', 'thanh nhan', 'thanh nhàn',
                   'truong dinh', 'trương định', 'vinh tuy', 'vĩnh tuy'],
};

const DANANG_SUBDISTRICTS: Record<string, string[]> = {
  'hai chau': ['hai chau 1', 'hải châu 1', 'hai chau 2', 'hải châu 2', 'hoa cuong bac', 'hòa cường bắc',
               'hoa cuong nam', 'hòa cường nam', 'hoa thuan dong', 'hòa thuận đông', 'hoa thuan tay', 'hòa thuận tây',
               'nam duong', 'nam dương', 'phuoc ninh', 'phước ninh', 'thanh binh', 'thạch thang', 'thạch thang',
               'thuan phuoc', 'thuận phước', 'binh hien', 'bình hiên', 'binh thuan', 'bình thuận'],
  'thanh khe': ['an khe', 'an khê', 'chinh gian', 'chính gián', 'hoa khe', 'hòa khê',
                'tam thuan', 'tâm thuan', 'tan chinh', 'tân chính', 'thac gian', 'thạc gián',
                'vinh trung', 'vĩnh trung', 'xuan ha', 'xuân hà'],
  'son tra': ['an hai bac', 'an hải bắc', 'an hai dong', 'an hải đông', 'an hai tay', 'an hải tây',
              'man thai', 'mân thái', 'nai hien dong', 'nại hiên đông', 'phuoc my', 'phước mỹ',
              'tho quang', 'thọ quang'],
  'ngu hanh son': ['hoa hai', 'hòa hải', 'hoa quy', 'hòa quý', 'khue my', 'khuê mỹ',
                   'my an', 'mỹ an', 'bac my an', 'bắc mỹ an'],
  'lien chieu': ['hoa hiep bac', 'hòa hiệp bắc', 'hoa hiep nam', 'hòa hiệp nam', 
                 'hoa khanh bac', 'hòa khánh bắc', 'hoa khanh nam', 'hòa khánh nam',
                 'hoa minh', 'hòa minh'],
  'cam le': ['hoa an', 'hòa an', 'hoa phat', 'hòa phát', 'hoa tho dong', 'hòa thọ đông',
             'hoa tho tay', 'hòa thọ tây', 'hoa xuan', 'hòa xuân', 'khue trung', 'khuê trung'],
};

// Famous roads/streets
const HCM_ROADS: Record<string, string> = {
  'nguyen hue': 'district 1', 'nguyễn huệ': 'district 1',
  'le loi': 'district 1', 'lê lợi': 'district 1',
  'dong khoi': 'district 1', 'đồng khởi': 'district 1',
  'hai ba trung': 'district 1', 'hai bà trưng': 'district 1',
  'le duan': 'district 1', 'lê duẩn': 'district 1',
  'nguyen thi minh khai': 'district 1', 'nguyễn thị minh khai': 'district 1',
  'nam ky khoi nghia': 'district 1', 'nam kỳ khởi nghĩa': 'district 1',
  'pasteur': 'district 1',
  'vo van tan': 'district 3', 'võ văn tấn': 'district 3',
  'le van sy': 'district 3', 'lê văn sỹ': 'district 3',
  'nguyen dinh chieu': 'district 3', 'nguyễn đình chiểu': 'district 3',
  'cach mang thang 8': 'district 3', 'cách mạng tháng 8': 'district 3',
  'xuan thuy': 'district 2', 'xuân thủy': 'district 2',
  'nguyen van huong': 'district 2', 'nguyễn văn hương': 'district 2',
  'quoc huong': 'district 2', 'quốc hương': 'district 2',
  'phan van dang': 'binh thanh', 'phan văn đáng': 'binh thanh',
  'dien bien phu': 'binh thanh', 'điện biên phủ': 'binh thanh',
  'bui vien': 'district 1', 'bùi viện': 'district 1',
  'de tham': 'district 1', 'đề thám': 'district 1',
  'pham ngu lao': 'district 1', 'phạm ngũ lão': 'district 1',
  'nguyen luong bang': 'district 7', 'nguyễn lương bằng': 'district 7',
  'le van luong': 'district 7', 'lê văn lương': 'district 7',
};

const LOCATION_DATA = {
  hcm: {
    name: 'Ho Chi Minh City',
    aliases: ['ho chi minh', 'hcm', 'saigon', 'sài gòn', 'sai gon', 'hồ chí minh', 'tp.hcm', 'tphcm'],
    districts: {
      center: {
        names: ['d1', 'district 1', 'quan 1', 'quận 1', 'q1', 'd3', 'district 3', 'quan 3', 'quận 3', 'q3'],
        description: 'Central business district with premium pricing, walkable, vibrant nightlife',
        avgPrice: { min: 15000000, max: 40000000 }
      },
      nearCenter: {
        names: ['d4', 'district 4', 'quan 4', 'quận 4', 'q4', 'd5', 'district 5', 'quan 5', 'quận 5', 'q5', 
                'binh thanh', 'bình thạnh', 'phu nhuan', 'phú nhuận', 'd10', 'district 10', 'quan 10', 'quận 10'],
        description: 'Close to center, good value, mix of local and expat communities',
        avgPrice: { min: 10000000, max: 25000000 }
      },
      suburban: {
        names: ['d7', 'district 7', 'quan 7', 'quận 7', 'q7', 'd2', 'district 2', 'quan 2', 'quận 2', 'q2',
                'thu duc', 'thủ đức', 'tan binh', 'tân bình', 'go vap', 'gò vấp', 'd9', 'district 9', 'quan 9', 'quận 9',
                'binh tan', 'bình tân', 'tan phu', 'tân phú', 'd12', 'district 12', 'quan 12', 'quận 12'],
        description: 'Modern developments, more space, family-friendly, requires transportation',
        avgPrice: { min: 7000000, max: 18000000 }
      }
    }
  },
  hanoi: {
    name: 'Hanoi',
    aliases: ['hanoi', 'ha noi', 'hà nội', 'hn'],
    districts: {
      center: {
        names: ['ba dinh', 'ba đình', 'hoan kiem', 'hoàn kiếm', 'dong da', 'đống đa'],
        description: 'Historic center, government area, traditional neighborhoods',
        avgPrice: { min: 12000000, max: 35000000 }
      },
      nearCenter: {
        names: ['hai ba trung', 'hai bà trưng', 'cau giay', 'cầu giấy', 'thanh xuan', 'thanh xuân',
                'hoang mai', 'hoàng mai'],
        description: 'Mixed residential/commercial, good connectivity',
        avgPrice: { min: 8000000, max: 20000000 }
      },
      suburban: {
        names: ['nam tu liem', 'nam từ liêm', 'bac tu liem', 'bắc từ liêm', 'tay ho', 'tây hồ', 
                'long bien', 'long biên', 'ha dong', 'hà đông', 'gia lam', 'gia lâm',
                'thanh tri', 'thanh trì', 'dong anh', 'đông anh', 'me linh', 'mê linh',
                'soc son', 'sóc sơn', 'hoai duc', 'hoài đức'],
        description: 'New developments, larger apartments, requires transportation',
        avgPrice: { min: 6000000, max: 15000000 }
      }
    }
  },
  danang: {
    name: 'Da Nang',
    aliases: ['da nang', 'đà nẵng', 'danang'],
    districts: {
      center: {
        names: ['hai chau', 'hải châu'],
        description: 'Central Da Nang, commercial hub',
        avgPrice: { min: 8000000, max: 20000000 }
      },
      nearCenter: {
        names: ['thanh khe', 'thanh khê', 'son tra', 'sơn trà'],
        description: 'Beach areas, tourist district',
        avgPrice: { min: 6000000, max: 15000000 }
      },
      suburban: {
        names: ['ngu hanh son', 'ngũ hành sơn', 'lien chieu', 'liên chiểu', 'cam le', 'cẩm lệ'],
        description: 'Residential areas, My Khe beach area',
        avgPrice: { min: 5000000, max: 12000000 }
      }
    }
  }
};

// Helper: Find parent district from sub-district or road
function findParentDistrict(text: string): { district: string, city: 'hcm' | 'hanoi' | 'danang' } | null {
  const lowerText = text.toLowerCase();
  
  // Check HCM sub-districts
  for (const [district, wards] of Object.entries(HCM_SUBDISTRICTS)) {
    if (wards.some(w => lowerText.includes(w))) {
      return { district, city: 'hcm' };
    }
  }
  
  // Check HCM roads
  for (const [road, district] of Object.entries(HCM_ROADS)) {
    if (lowerText.includes(road)) {
      return { district, city: 'hcm' };
    }
  }
  
  // Check Hanoi sub-districts
  for (const [district, wards] of Object.entries(HANOI_SUBDISTRICTS)) {
    if (wards.some(w => lowerText.includes(w))) {
      return { district, city: 'hanoi' };
    }
  }
  
  // Check Da Nang sub-districts
  for (const [district, wards] of Object.entries(DANANG_SUBDISTRICTS)) {
    if (wards.some(w => lowerText.includes(w))) {
      return { district, city: 'danang' };
    }
  }
  
  return null;
}

// ========== ENHANCED DETECTION FUNCTIONS ==========
function detectCity(text: string): 'hcm' | 'hanoi' | 'danang' | null {
  const lowerText = text.toLowerCase();
  
  // Check HCMC aliases and districts
  if (LOCATION_DATA.hcm.aliases.some(a => lowerText.includes(a))) return 'hcm';
  for (const tier of Object.values(LOCATION_DATA.hcm.districts)) {
    if (tier.names.some(d => lowerText.includes(d))) return 'hcm';
  }
  // Check HCM sub-districts and roads
  for (const wards of Object.values(HCM_SUBDISTRICTS)) {
    if (wards.some(w => lowerText.includes(w))) return 'hcm';
  }
  for (const road of Object.keys(HCM_ROADS)) {
    if (lowerText.includes(road)) return 'hcm';
  }
  
  // Check Hanoi aliases and districts
  if (LOCATION_DATA.hanoi.aliases.some(a => lowerText.includes(a))) return 'hanoi';
  for (const tier of Object.values(LOCATION_DATA.hanoi.districts)) {
    if (tier.names.some(d => lowerText.includes(d))) return 'hanoi';
  }
  for (const wards of Object.values(HANOI_SUBDISTRICTS)) {
    if (wards.some(w => lowerText.includes(w))) return 'hanoi';
  }
  
  // Check Da Nang aliases and districts
  if (LOCATION_DATA.danang.aliases.some(a => lowerText.includes(a))) return 'danang';
  for (const tier of Object.values(LOCATION_DATA.danang.districts)) {
    if (tier.names.some(d => lowerText.includes(d))) return 'danang';
  }
  for (const wards of Object.values(DANANG_SUBDISTRICTS)) {
    if (wards.some(w => lowerText.includes(w))) return 'danang';
  }
  
  return null;
}

function getLocationTier(location: string, city: 'hcm' | 'hanoi'): 'center' | 'near-center' | 'suburban' | 'unknown' {
  const locLower = location.toLowerCase();
  const cityData = LOCATION_DATA[city];
  
  if (cityData.districts.center.names.some(d => locLower.includes(d))) return 'center';
  if (cityData.districts.nearCenter.names.some(d => locLower.includes(d))) return 'near-center';
  if (cityData.districts.suburban.names.some(d => locLower.includes(d))) return 'suburban';
  
  return 'unknown';
}

function isCenterRequest(text: string): boolean {
  const lowerText = text.toLowerCase();
  return /\b(center|central|trung tâm|trung tam|downtown|city center|nội thành|noi thanh)\b/.test(lowerText);
}

function parsePrice(text: string): number | null {
  const patterns = [
    /(?:under|below|less than|dưới|max|maximum|budget)\s*(\d+(?:\.\d+)?)\s*(mil|million|m|tr|triệu|trieu)/gi,
    /(\d+(?:\.\d+)?)\s*(mil|million|m|tr|triệu|trieu)\s*(?:or less|max|maximum|budget|vnd)/gi,
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:vnd|đồng|dong)/gi, // Direct VND amounts
  ];
  
  for (const pattern of patterns) {
    const matches = text.toLowerCase().matchAll(pattern);
    for (const match of matches) {
      let value = parseFloat(match[1].replace(/,/g, ''));
      
      // Convert to VND if in millions
      if (match[2] && /mil|million|m|tr|triệu|trieu/i.test(match[2])) {
        value = value * 1000000;
      }
      
      if (value > 0 && value < 100000000) { // Reasonable price range
        return value;
      }
    }
  }
  return null;
}

function extractAmenities(text: string): string[] {
  const lowerText = text.toLowerCase();
  const amenityMap: Record<string, string[]> = {
    'balcony': ['balcony', 'ban công', 'ban cong'],
    'pool': ['pool', 'swimming', 'hồ bơi', 'ho boi', 'bể bơi', 'be boi'],
    'gym': ['gym', 'fitness', 'phòng gym', 'phong gym', 'tập gym', 'tap gym'],
    'parking': ['parking', 'đỗ xe', 'do xe', 'bãi đỗ', 'bai do', 'garage'],
    'pet': ['pet', 'thú cưng', 'thu cung', 'dog', 'cat', 'chó', 'cho', 'mèo', 'meo'],
    'furnished': ['furnished', 'nội thất', 'noi that', 'đầy đủ', 'day du'],
    'wifi': ['wifi', 'internet', 'mạng', 'mang'],
    'elevator': ['elevator', 'thang máy', 'thang may', 'lift'],
    'security': ['security', 'bảo vệ', 'bao ve', 'an ninh'],
    'garden': ['garden', 'vườn', 'vuon', 'sân vườn', 'san vuon'],
    'sofa': ['sofa', 'ghế sofa', 'ghe sofa', 'couch'],
    'tv': ['tv', 'tivi', 'ti vi', 'television', 'smart tv'],
    'washing machine': ['washing machine', 'máy giặt', 'may giat', 'laundry'],
    'air conditioning': ['air conditioning', 'ac', 'điều hòa', 'dieu hoa', 'máy lạnh', 'may lanh'],
    'kitchen': ['kitchen', 'bếp', 'bep', 'nhà bếp', 'nha bep'],
  };
  
  const found: string[] = [];
  for (const [canonical, variations] of Object.entries(amenityMap)) {
    if (variations.some(v => lowerText.includes(v))) {
      found.push(canonical);
    }
  }
  return found;
}

function extractStyles(text: string): string[] {
  const lowerText = text.toLowerCase();
  const styles = ['luxury', 'modern', 'cozy', 'minimalist', 'industrial', 'bohemian', 
                  'scandinavian', 'contemporary', 'traditional', 'rustic', 'urban', 'vintage'];
  return styles.filter(s => lowerText.includes(s));
}

// ========== ACCUMULATED CONTEXT TYPE ==========
interface AccumulatedContext {
  city: 'hcm' | 'hanoi' | 'danang' | null;
  wantsCenter: boolean;
  locationTier: 'center' | 'near-center' | 'suburban' | null;
  maxPrice: number | null;
  minPrice: number | null;
  amenities: string[];
  styles: string[];
  specificDistricts: string[];
}

// Extract specific districts/areas mentioned by user (including sub-districts and roads)
function extractSpecificDistricts(text: string): string[] {
  const lowerText = text.toLowerCase();
  const districts: string[] = [];
  
  // HCM main districts
  const hcmMainDistricts = [
    { names: ['d1', 'district 1', 'quan 1', 'quận 1', 'q1'], canonical: 'district 1' },
    { names: ['d2', 'district 2', 'quan 2', 'quận 2', 'q2'], canonical: 'district 2' },
    { names: ['d3', 'district 3', 'quan 3', 'quận 3', 'q3'], canonical: 'district 3' },
    { names: ['d4', 'district 4', 'quan 4', 'quận 4', 'q4'], canonical: 'district 4' },
    { names: ['d5', 'district 5', 'quan 5', 'quận 5', 'q5'], canonical: 'district 5' },
    { names: ['d7', 'district 7', 'quan 7', 'quận 7', 'q7'], canonical: 'district 7' },
    { names: ['d10', 'district 10', 'quan 10', 'quận 10', 'q10'], canonical: 'district 10' },
    { names: ['binh thanh', 'bình thạnh'], canonical: 'binh thanh' },
    { names: ['phu nhuan', 'phú nhuận'], canonical: 'phu nhuan' },
    { names: ['tan binh', 'tân bình'], canonical: 'tan binh' },
    { names: ['go vap', 'gò vấp'], canonical: 'go vap' },
    { names: ['thu duc', 'thủ đức'], canonical: 'thu duc' },
  ];
  
  // HCM sub-areas (wards) - with their parent district
  const hcmSubAreas = [
    // D1 wards
    { names: ['da kao', 'đa kao', 'dakao'], canonical: 'da kao', parent: 'district 1' },
    { names: ['ben nghe', 'bến nghé'], canonical: 'ben nghe', parent: 'district 1' },
    { names: ['ben thanh', 'bến thành'], canonical: 'ben thanh', parent: 'district 1' },
    { names: ['nguyen thai binh', 'nguyễn thái bình'], canonical: 'nguyen thai binh', parent: 'district 1' },
    { names: ['pham ngu lao', 'phạm ngũ lão'], canonical: 'pham ngu lao', parent: 'district 1' },
    { names: ['tan dinh', 'tân định'], canonical: 'tan dinh', parent: 'district 1' },
    // D2 wards
    { names: ['thao dien', 'thảo điền'], canonical: 'thao dien', parent: 'district 2' },
    { names: ['an phu', 'an phú'], canonical: 'an phu', parent: 'district 2' },
    { names: ['thu thiem', 'thủ thiêm'], canonical: 'thu thiem', parent: 'district 2' },
    { names: ['cat lai', 'cát lái'], canonical: 'cat lai', parent: 'district 2' },
    { names: ['thanh my loi', 'thạnh mỹ lợi'], canonical: 'thanh my loi', parent: 'district 2' },
    { names: ['binh an', 'bình an'], canonical: 'binh an', parent: 'district 2' },
    // D7 wards
    { names: ['phu my hung', 'phú mỹ hưng'], canonical: 'phu my hung', parent: 'district 7' },
    { names: ['tan phong', 'tân phong'], canonical: 'tan phong', parent: 'district 7' },
    { names: ['tan phu', 'tân phú'], canonical: 'tan phu d7', parent: 'district 7' },
  ];
  
  // Hanoi main districts
  const hanoiMainDistricts = [
    { names: ['ba dinh', 'ba đình'], canonical: 'ba dinh' },
    { names: ['hoan kiem', 'hoàn kiếm'], canonical: 'hoan kiem' },
    { names: ['dong da', 'đống đa'], canonical: 'dong da' },
    { names: ['cau giay', 'cầu giấy'], canonical: 'cau giay' },
    { names: ['tay ho', 'tây hồ'], canonical: 'tay ho' },
    { names: ['hai ba trung', 'hai bà trưng'], canonical: 'hai ba trung' },
    { names: ['thanh xuan', 'thanh xuân'], canonical: 'thanh xuan' },
    { names: ['long bien', 'long biên'], canonical: 'long bien' },
  ];
  
  // Da Nang main districts
  const danangMainDistricts = [
    { names: ['hai chau', 'hải châu'], canonical: 'hai chau' },
    { names: ['thanh khe', 'thanh khê'], canonical: 'thanh khe' },
    { names: ['son tra', 'sơn trà'], canonical: 'son tra' },
    { names: ['ngu hanh son', 'ngũ hành sơn'], canonical: 'ngu hanh son' },
    { names: ['lien chieu', 'liên chiểu'], canonical: 'lien chieu' },
    { names: ['cam le', 'cẩm lệ'], canonical: 'cam le' },
    { names: ['my khe', 'mỹ khê'], canonical: 'my khe' },
  ];
  
  // Check main districts first
  for (const area of [...hcmMainDistricts, ...hanoiMainDistricts, ...danangMainDistricts]) {
    if (area.names.some(n => lowerText.includes(n))) {
      if (!districts.includes(area.canonical)) {
        districts.push(area.canonical);
      }
    }
  }
  
  // Check sub-areas and add both the sub-area AND its parent district
  for (const area of hcmSubAreas) {
    if (area.names.some(n => lowerText.includes(n))) {
      if (!districts.includes(area.canonical)) {
        districts.push(area.canonical);
      }
      // Also add parent district for broader matching
      if (!districts.includes(area.parent)) {
        districts.push(area.parent);
      }
    }
  }
  
  // Check for road names and add their districts
  for (const [road, district] of Object.entries(HCM_ROADS)) {
    if (lowerText.includes(road)) {
      if (!districts.includes(district)) {
        districts.push(district);
      }
    }
  }
  
  return districts;
}

function buildAccumulatedContext(chatHistory: Array<{role: string, content: string}>, currentMessage: string): AccumulatedContext {
  const context: AccumulatedContext = {
    city: null,
    wantsCenter: false,
    locationTier: null,
    maxPrice: null,
    minPrice: null,
    amenities: [],
    styles: [],
    specificDistricts: []
  };
  
  // Parse ONLY USER messages for preferences (ignore AI responses to prevent contamination)
  const userMessages = chatHistory
    .filter(m => m.role === 'user')
    .map(m => m.content);
  
  // Add current message (which is always from user)
  const allUserTexts = [...userMessages, currentMessage];
  
  for (const text of allUserTexts) {
    // City detection - PRIORITY: current message overrides history, but only user input matters
    const detectedCity = detectCity(text);
    if (detectedCity) context.city = detectedCity;
    
    // Center preference
    if (isCenterRequest(text)) context.wantsCenter = true;
    
    // Price detection (take the most restrictive)
    const price = parsePrice(text);
    if (price && (!context.maxPrice || price < context.maxPrice)) {
      context.maxPrice = price;
    }
    
    // Amenities (accumulate)
    const amenities = extractAmenities(text);
    for (const a of amenities) {
      if (!context.amenities.includes(a)) context.amenities.push(a);
    }
    
    // Styles (accumulate)
    const styles = extractStyles(text);
    for (const s of styles) {
      if (!context.styles.includes(s)) context.styles.push(s);
    }
    
    // Extract specific districts (accumulate)
    const specificDistricts = extractSpecificDistricts(text);
    for (const d of specificDistricts) {
      if (!context.specificDistricts.includes(d)) context.specificDistricts.push(d);
    }
  }
  
  // Determine location tier based on center preference
  if (context.wantsCenter) {
    context.locationTier = 'center';
  }
  
  return context;
}

// Detect if user is asking to compare/filter previous results (not a new search)
function detectComparisonQuery(message: string): boolean {
  const comparisonPatterns = [
    // Preference statements about previous results
    /i prefer/i,
    /i would prefer/i,
    /i'd prefer/i,
    /i like the/i, // "i like the first one" but not "i like modern style"
    /i want the/i, // "i want the one with" but not "i want a new apartment"
    // With specific amenities (comparison context)
    /with (a )?(sofa|balcony|pool|gym|tv|tivi|kitchen|parking|washing)/i,
    // Questions about previous results - HIGHEST PRIORITY
    /which (one|ones?|of these|of them|has|have)/i,
    /do (any|these|they) (have|has)/i,
    /does (it|any|this|that) (have|has)/i,
    /is there (any|one) (with|that has)/i,
    /are there any (with|that have)/i,
    // Checking for specific amenities in previous results
    /have (a |the )?(sofa|balcony|pool|gym|parking|tv|tivi|kitchen|washing|air con)/i,
    /has (a |the )?(sofa|balcony|pool|gym|parking|tv|tivi|kitchen|washing|air con)/i,
    /(any|which).*(tv|tivi|sofa|balcony|pool|gym|parking)/i,
    // Comparison requests
    /what about/i,
    /how about the/i,
    /compare/i,
    /between these/i,
    /among these/i,
    // Filtering requests
    /filter/i,
    /only show/i,
    /only the ones/i,
    /just the ones/i,
    /narrow/i,
    /narrow down/i,
    // Vietnamese patterns
    /cái nào/i,
    /căn nào/i,
    /phòng nào/i,
  ];
  
  return comparisonPatterns.some(p => p.test(message));
}

// ========== PROPERTY FILTERING & SCORING ==========
interface PropertyWithScore {
  id: string;
  title: string;
  location: string;
  price: number;
  description: string;
  highlights: string[];
  amenities: string[];
  styles: string[];
  images: string[];
  realtor_id: string;
  size: string;
  vibe: string;
  providerName?: string;
  providerPhone?: string;
  // Scoring
  matchScore: number;
  priceMatch: boolean;
  locationMatch: boolean;
  amenityMatchCount: number;
  styleMatchCount: number;
  locationTier: string;
  matchReasons: string[];
  // Whether this property is an exact sub-area match (e.g., Thao Dien when user asked for Thao Dien)
  isExactSubAreaMatch?: boolean;
}


function filterAndScoreProperties(
  properties: any[], 
  context: AccumulatedContext
): PropertyWithScore[] {
  const scored: PropertyWithScore[] = [];
  
  for (const p of properties) {
    const locLower = p.location.toLowerCase();
    const amenities = p.vibe_analysis?.amenities || p.amenities || [];
    const styles = p.vibe_analysis?.styles || [];
    
    // ========== HARD FILTERS (Eliminate non-matching) ==========
    
    // 1. City filter (STRICT)
    if (context.city) {
      const otherCityData = context.city === 'hcm' ? LOCATION_DATA.hanoi : LOCATION_DATA.hcm;
      const isOtherCity = otherCityData.aliases.some(a => locLower.includes(a)) ||
        Object.values(otherCityData.districts).some(tier => 
          tier.names.some(d => locLower.includes(d))
        );
      if (isOtherCity) continue; // Skip properties from wrong city
    }
    
    // 2. Must have amenities
    if (amenities.length === 0) continue;
    
    // ========== SCORING ==========
    let score = 50; // Base score
    const matchReasons: string[] = [];
    
    // Price match
    const priceMatch = context.maxPrice ? p.price <= context.maxPrice : true;
    if (priceMatch && context.maxPrice) {
      score += 25;
      const savings = context.maxPrice - p.price;
      if (savings > 0) {
        matchReasons.push(`${(savings/1000000).toFixed(1)}M under budget`);
      }
    } else if (!priceMatch) {
      score -= 30; // Penalty for over budget
    }
    
    // Specific district match (HIGHEST PRIORITY when user mentions specific areas)
    let locationMatch = true;
    let matchedSpecificDistrict = false;
    let isExactSubAreaMatch = false;
    
    if (context.specificDistricts.length > 0) {
      // Sub-areas mapped to parent districts
      const districtSubAreas: Record<string, string[]> = {
        'district 1': ['da kao', 'ben nghe', 'ben thanh', 'nguyen thai binh', 'pham ngu lao', 'tan dinh', 'cau kho', 'co giang'],
        'district 2': ['thao dien', 'an phu', 'thu thiem', 'cat lai', 'thanh my loi', 'binh an', 'binh khanh', 'an khanh'],
        'district 3': ['vo thi sau'],
        'district 7': ['phu my hung', 'tan phong', 'tan phu d7', 'tan hung', 'tan kieng'],
        'binh thanh': ['thanh da', 'binh quoi', 'hang xanh', 'van thanh'],
      };
      
      // Determine which parent districts user wants based on sub-areas mentioned
      const wantedParentDistricts = new Set<string>();
      for (const [parent, subAreas] of Object.entries(districtSubAreas)) {
        if (context.specificDistricts.includes(parent)) {
          wantedParentDistricts.add(parent);
        }
        for (const sub of subAreas) {
          if (context.specificDistricts.includes(sub)) {
            wantedParentDistricts.add(parent);
          }
        }
      }
      // Also add directly mentioned main districts
      for (const d of context.specificDistricts) {
        if (['district 1', 'district 2', 'district 3', 'district 7', 'binh thanh', 'phu nhuan', 'thu duc', 'go vap', 'tan binh'].includes(d)) {
          wantedParentDistricts.add(d);
        }
      }
      
      // Check if property matches any requested specific area (exact match)
      const matchesExactArea = context.specificDistricts.some(district => {
        if (district === 'district 1' && (locLower.includes('district 1') || locLower.includes('d1,') || locLower.includes('quan 1'))) return true;
        if (district === 'district 2' && (locLower.includes('district 2') || locLower.includes('d2,') || locLower.includes('quan 2'))) return true;
        if (district === 'district 3' && (locLower.includes('district 3') || locLower.includes('d3,') || locLower.includes('quan 3'))) return true;
        if (district === 'district 7' && (locLower.includes('district 7') || locLower.includes('d7,') || locLower.includes('quan 7'))) return true;
        if (district === 'thao dien' && (locLower.includes('thao dien') || locLower.includes('thảo điền'))) return true;
        if (district === 'da kao' && (locLower.includes('da kao') || locLower.includes('đa kao') || locLower.includes('dakao'))) return true;
        if (district === 'an phu' && (locLower.includes('an phu') || locLower.includes('an phú'))) return true;
        if (district === 'binh thanh' && (locLower.includes('binh thanh') || locLower.includes('bình thạnh'))) return true;
        if (district === 'phu nhuan' && (locLower.includes('phu nhuan') || locLower.includes('phú nhuận'))) return true;
        if (district === 'phu my hung' && (locLower.includes('phu my hung') || locLower.includes('phú mỹ hưng'))) return true;
        if (district === 'thu thiem' && (locLower.includes('thu thiem') || locLower.includes('thủ thiêm'))) return true;
        return locLower.includes(district);
      });
      
      // Check if property is in a parent district that user wants
      const matchesParentDistrict = Array.from(wantedParentDistricts).some(parent => {
        if (parent === 'district 1' && (locLower.includes('district 1') || locLower.includes('quan 1') || /\bd1\b/.test(locLower))) return true;
        if (parent === 'district 2' && (locLower.includes('district 2') || locLower.includes('quan 2') || /\bd2\b/.test(locLower))) return true;
        if (parent === 'district 3' && (locLower.includes('district 3') || locLower.includes('quan 3') || /\bd3\b/.test(locLower))) return true;
        if (parent === 'district 7' && (locLower.includes('district 7') || locLower.includes('quan 7') || /\bd7\b/.test(locLower))) return true;
        if (parent === 'binh thanh' && (locLower.includes('binh thanh') || locLower.includes('bình thạnh'))) return true;
        if (parent === 'phu nhuan' && (locLower.includes('phu nhuan') || locLower.includes('phú nhuận'))) return true;
        return locLower.includes(parent);
      });
      
      // Check if property is an EXACT match to user's requested sub-area (e.g., "Thao Dien" when user asked for Thao Dien)
      const requestedSubAreas = context.specificDistricts.filter(d => 
        !['district 1', 'district 2', 'district 3', 'district 7', 'binh thanh', 'phu nhuan', 'thu duc', 'go vap', 'tan binh'].includes(d)
      );
      
      const matchesExactSubArea = requestedSubAreas.length > 0 && requestedSubAreas.some(subArea => {
        if (subArea === 'thao dien' && (locLower.includes('thao dien') || locLower.includes('thảo điền'))) return (isExactSubAreaMatch = true);
        if (subArea === 'da kao' && (locLower.includes('da kao') || locLower.includes('đa kao') || locLower.includes('dakao'))) return (isExactSubAreaMatch = true);
        if (subArea === 'an phu' && (locLower.includes('an phu') || locLower.includes('an phú'))) return (isExactSubAreaMatch = true);
        if (subArea === 'phu my hung' && (locLower.includes('phu my hung') || locLower.includes('phú mỹ hưng'))) return (isExactSubAreaMatch = true);
        if (subArea === 'thu thiem' && (locLower.includes('thu thiem') || locLower.includes('thủ thiêm'))) return (isExactSubAreaMatch = true);
        if (locLower.includes(subArea)) return (isExactSubAreaMatch = true);
        return false;
      });
 
      if (matchesExactSubArea) {
        score += 50; // HIGHEST bonus for exact sub-area match (Thao Dien when asked for Thao Dien)
        matchedSpecificDistrict = true;
        matchReasons.push(`exactly in ${p.location.split(',')[0]}`);
        console.log(`[Scoring] Property ${p.id} EXACT sub-area match: ${p.location}`);
      } else if (matchesExactArea) {
        score += 40; // High bonus for exact district match
        matchedSpecificDistrict = true;
        matchReasons.push(`in ${p.location.split(',')[0]}`);
        console.log(`[Scoring] Property ${p.id} exact area match: ${p.location}`);
      } else if (matchesParentDistrict) {
        score += 25; // Lower bonus for parent district (D2 when asked for Thao Dien)
        matchedSpecificDistrict = true;
        matchReasons.push(`in nearby ${p.location.split(',')[0]}`);
        console.log(`[Scoring] Property ${p.id} parent district match: ${p.location}`);
      } else {
        // NOT in requested districts - lower priority but still include
        score -= 5;
        locationMatch = false;
      }
    }
    
    // Location tier match - only apply if no specific districts were requested
    const locationTier = context.city ? getLocationTier(p.location, context.city) : 'unknown';
    
    if (!matchedSpecificDistrict && context.wantsCenter) {
      if (locationTier === 'center') {
        score += 30;
        matchReasons.push('in city center');
        locationMatch = true;
      } else if (locationTier === 'near-center') {
        score += 15;
        matchReasons.push('near city center');
        locationMatch = false; // Partial match
      } else if (locationTier === 'suburban') {
        // Don't heavily penalize - just don't give bonus
        score += 0;
        matchReasons.push(`in ${p.location.split(',')[0]} area`);
        locationMatch = false;
      } else {
        // Unknown location in the target city - mild penalty
        score -= 5;
        locationMatch = false;
      }
    }
    
    // Amenity match
    const lowerAmenities = amenities.map((a: string) => a.toLowerCase());
    let amenityMatchCount = 0;
    const matchedAmenities: string[] = [];
    const missingAmenities: string[] = [];
    for (const reqAmenity of context.amenities) {
      if (lowerAmenities.some((a: string) => a.includes(reqAmenity) || reqAmenity.includes(a))) {
        amenityMatchCount++;
        matchedAmenities.push(reqAmenity);
        score += 10;
      } else {
        missingAmenities.push(reqAmenity);
      }
    }
    if (context.amenities.length > 0 && amenityMatchCount === context.amenities.length) {
      matchReasons.push(`has ${matchedAmenities.join(', ')}`);
    } else if (matchedAmenities.length > 0 && missingAmenities.length > 0) {
      matchReasons.push(`has ${matchedAmenities.join(', ')} but no ${missingAmenities.join(', ')}`);
    } else if (missingAmenities.length > 0 && matchedAmenities.length === 0) {
      matchReasons.push(`no ${missingAmenities.join(', ')}`);
    }
    
    // Style match
    const lowerStyles = styles.map((s: string) => s.toLowerCase());
    let styleMatchCount = 0;
    for (const reqStyle of context.styles) {
      if (lowerStyles.some((s: string) => s.includes(reqStyle))) {
        styleMatchCount++;
        score += 5;
      }
    }
    if (styleMatchCount > 0) {
      matchReasons.push(`${context.styles.filter(s => lowerStyles.some((ls: string) => ls.includes(s))).join(', ')} style`);
    }
    
    // Cap score at 100 for display, but keep exact sub-area first via separate flag
    score = Math.min(100, Math.max(0, score));
    
    scored.push({
      id: p.id,
      title: p.title,
      location: p.location,
      price: p.price,
      description: p.description || '',
      highlights: p.highlights || [],
      amenities,
      styles,
      images: p.images || [],
      realtor_id: p.realtor_id,
      size: p.size || '',
      vibe: p.vibe || styles.join(', ') || 'Modern',
      providerName: p.property_source_provider_name,
      providerPhone: p.property_source_provider_phone,
      matchScore: score,
      priceMatch,
      locationMatch,
      amenityMatchCount,
      styleMatchCount,
      locationTier,
      matchReasons,
      isExactSubAreaMatch,
    });
  }
  
  // Sort by priority: exact sub-area matches first, then by score
  return scored.sort((a, b) => {
    if (a.isExactSubAreaMatch && !b.isExactSubAreaMatch) return -1;
    if (!a.isExactSubAreaMatch && b.isExactSubAreaMatch) return 1;
    return b.matchScore - a.matchScore;
  });
}

// ========== POST-PROCESSING VALIDATION ==========
function validateAndFixAIResults(
  aiResults: any[], 
  validProperties: PropertyWithScore[],
  context: AccumulatedContext
): any[] {
  const validIds = new Set(validProperties.map(p => p.id));
  const validatedResults: any[] = [];
  
  for (const result of aiResults) {
    // Skip if property doesn't exist in our filtered set
    if (!validIds.has(result.id)) {
      console.log(`[Validation] Rejecting AI result ${result.id} - not in valid property set`);
      continue;
    }
    
    // Find the actual property data
    const actualProperty = validProperties.find(p => p.id === result.id);
    if (!actualProperty) continue;
    
    // Fix any incorrect data
    const fixed = {
      ...result,
      price: actualProperty.price, // Use actual price
      location: actualProperty.location, // Use actual location
      images: actualProperty.images, // Use actual images
      realtor_id: actualProperty.realtor_id,
      matchScore: actualProperty.matchScore, // Use our calculated score
    };
    
    // Verify price constraint
    if (context.maxPrice && actualProperty.price > context.maxPrice) {
      console.log(`[Validation] Property ${result.id} is over budget (${actualProperty.price} > ${context.maxPrice}), flagging`);
      fixed.matchReason = `⚠️ Over budget: ${(actualProperty.price/1000000).toFixed(1)}M VND/month (your budget: ${(context.maxPrice/1000000).toFixed(0)}M). ${result.matchReason || ''}`;
      fixed.matchScore = Math.max(10, fixed.matchScore - 30);
    }
    
    validatedResults.push(fixed);
  }
  
  return validatedResults;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase env and clients early
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check for authentication (optional for anonymous users)
    const authHeader = req.headers.get('authorization');
    let user = null;
    let isAnonymous = false;

    if (authHeader && !authHeader.includes(supabaseAnonKey)) {
      const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      
      const token = authHeader.replace('Bearer ', '');
      const { data: userData, error: authError } = await userSupabase.auth.getUser(token);
      
      if (!authError && userData.user) {
        user = userData.user;
        console.log('Authenticated user:', user.id);
      } else {
        console.log('Invalid token, treating as anonymous user');
        isAnonymous = true;
      }
    } else {
      console.log('No auth header, treating as anonymous user');
      isAnonymous = true;
    }

    console.log('Chat AI function called');

    // Rate limiting for anonymous users
    if (isAnonymous) {
      const xForwardedFor = req.headers.get('x-forwarded-for');
      const xRealIp = req.headers.get('x-real-ip');
      const cfConnectingIp = req.headers.get('cf-connecting-ip');
      const clientIP = (xForwardedFor?.split(',')[0].trim() || xRealIp || cfConnectingIp || 'unknown');

      if (clientIP !== 'unknown') {
        try {
          const today = new Date().toISOString().split('T')[0];
          const rateLimitKey = `anon_rate:${clientIP}:${today}`;
          const attempts = await redis.get(rateLimitKey) as number | null;
          const currentAttempts = attempts || 0;
          
          console.log(`[Redis] Anonymous user search count: ${currentAttempts}/2 for IP: ${clientIP}`);
          
          if (currentAttempts >= 2) {
            return new Response(
              JSON.stringify({ 
                response: 'You\'ve used your 2 free searches today! To get unlimited AI-powered property searches, please sign in or create a free account.',
                requiresAuth: true
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            );
          }
          
          await redis.incr(rateLimitKey);
          await redis.expire(rateLimitKey, 86400);
        } catch (redisError) {
          console.error('[Redis] Error checking rate limit:', redisError);
        }
      }
    }
    
    const requestBody = await req.text();
    if (!requestBody) {
      return new Response(
        JSON.stringify({ error: 'Empty request body' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(requestBody);
    } catch (parseError) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const { message, conversationId, userType, userPreferences, propertyImages } = parsedBody;
    
    console.log('Request data:', { 
      messageLength: message?.length, 
      conversationId, 
      userType, 
      hasPreferences: !!userPreferences,
      hasPropertyImages: !!propertyImages,
      isAnonymous
    });

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Fetch active properties
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    
    const { data: propertiesData, error: propertiesError } = await supabase
      .from('properties')
      .select('*')
      .eq('is_active', true)
      .gte('last_activated_at', tenDaysAgo.toISOString());

    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError);
      throw propertiesError;
    }
    
    const properties = propertiesData || [];
    console.log(`Found ${properties.length} active properties`);

    // Helper functions
    const isValidUUID = (v: string | null | undefined) =>
      typeof v === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
    const canPersist = !isAnonymous && isValidUUID(conversationId);
    let chatHistory: Array<{role: string, content: string}> = [];
    
    // Get conversation history for authenticated users
    if (canPersist) {
      const { data: conversation, error: convError } = await supabase
        .from('chat_conversations')
        .select('user_id')
        .eq('id', conversationId)
        .eq('user_id', user?.id)
        .single();
      
      if (convError || !conversation) {
        return new Response(
          JSON.stringify({ error: 'Conversation not found or access denied' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }

      const { data: history } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(15); // Increased history limit for better context

      chatHistory = history || [];
    }

    const maxResults = isAnonymous ? 3 : 5;

    // Collect properties that were already suggested in this conversation so we can surface fresh options
    let previouslySuggestedIds = new Set<string>();
    let previouslySuggestedProperties: any[] = [];
    if (canPersist && user?.id) {
      try {
        const { data: pastSearches } = await supabase
          .from('ai_searches')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(3); // Get last 3 searches for context

        const searchIds = (pastSearches || []).map((s: any) => s.id);

        if (searchIds.length > 0) {
          const { data: pastResults } = await supabase
            .from('ai_search_results')
            .select('property_id')
            .in('search_id', searchIds);

          previouslySuggestedIds = new Set((pastResults || []).map((r: any) => r.property_id));
          
          // Get full property details for previously suggested properties
          if (previouslySuggestedIds.size > 0) {
            previouslySuggestedProperties = properties.filter((p: any) => previouslySuggestedIds.has(p.id));
            console.log(`[Context] Found ${previouslySuggestedProperties.length} previously suggested properties`);
          }
        }
      } catch (historyError) {
        console.error('[Search History] Error loading previous results:', historyError);
      }
    }
    
    // Detect if user is asking to compare/filter previous results
    const isComparisonQuery = detectComparisonQuery(message.toLowerCase());

    // ========== REALTOR MODE ==========
    if (userType === 'realtor') {
      const systemPrompt = `You are Hausto AI, a helpful assistant for real estate professionals. You help realtors create compelling property descriptions, titles, and marketing content.

STANDARD PROPERTY HIGHLIGHTS:
Style Tags: Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage
Amenity Tags: Pet Friendly, Gym Access, Pool, Parking, Balcony, Garden, Elevator, Security, WiFi, Furnished, Air Conditioning, Washing Machine
Location Tags: City Center, Quiet Neighborhood, Near Metro, Shopping Nearby, School District, Business District
Feature Tags: High Ceilings, Natural Light, Open Plan, Walk-in Closet, En-suite Bathroom, Kitchen Island, Hardwood Floors

When analyzing property images, ONLY use tags from the standard list above.`;

      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
      if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
          ],
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Lovable AI error:', response.status, errorText);
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.choices[0].message.content;

      if (canPersist) {
        await supabase.from('chat_messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: aiResponse
        });
      }

      return new Response(JSON.stringify({ response: aiResponse }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // ========== RENTER MODE - Enhanced AI Search ==========
    
    // Build accumulated context from conversation history
    const accContext = buildAccumulatedContext(chatHistory, message);
    console.log('[Context] Accumulated preferences:', JSON.stringify(accContext));
    console.log('[Context] Is comparison query:', isComparisonQuery, '| Previous properties:', previouslySuggestedProperties.length);

    // For comparison queries, we need to check previous properties first
    // Score the previously suggested properties to see which match the new criteria
    const scoredPreviousProperties = isComparisonQuery && previouslySuggestedProperties.length > 0
      ? filterAndScoreProperties(previouslySuggestedProperties, accContext)
      : [];
    
    console.log(`[Comparison] Scored ${scoredPreviousProperties.length} previous properties`);

    // ========== STRICT COMPARISON MODE ==========
    // If this is a comparison query and we have previous properties, return direct comparison without AI call
    if (isComparisonQuery && previouslySuggestedProperties.length > 0) {
      console.log('[Comparison] STRICT MODE: Evaluating previous properties without AI call');
      
      // Check which previous properties match the new criteria (e.g., have TV, sofa, etc.)
      const matchingPrevious = scoredPreviousProperties.filter(p => {
        // Check if property has all required amenities from current context
        if (accContext.amenities.length > 0) {
          const propAmenities = (p.amenities || []).map(a => a.toLowerCase());
          return accContext.amenities.every(reqAmenity => 
            propAmenities.some(pa => pa.includes(reqAmenity.toLowerCase()))
          );
        }
        return p.matchScore >= 50; // Default: return properties with decent match
      });

      console.log(`[Comparison] Found ${matchingPrevious.length} matching from ${previouslySuggestedProperties.length} previous properties`);

      // Build comparison response
      let comparisonSummary = '';
      let comparisonResults: any[] = [];

      if (matchingPrevious.length > 0) {
        // Some previous properties match the new criteria
        comparisonSummary = `Looking at the ${previouslySuggestedProperties.length} properties I showed you earlier: ${matchingPrevious.length} ${matchingPrevious.length === 1 ? 'has' : 'have'} ${accContext.amenities.length > 0 ? accContext.amenities.join(', ') : 'your requirements'}.`;
        comparisonResults = matchingPrevious.map(p => ({
          id: p.id,
          title: p.title,
          location: p.location,
          price: p.price,
          size: p.size,
          vibe: p.vibe,
          description: p.description,
          highlights: p.highlights,
          images: p.images,
          matchScore: p.matchScore,
          matchReason: `This property has ${accContext.amenities.filter(a => 
            (p.amenities || []).some(pa => pa.toLowerCase().includes(a.toLowerCase()))
          ).join(', ') || 'features you asked about'}`,
          realtor_id: p.realtor_id,
          isExternal: false,
          source: null,
          sourceUrl: null
        }));
      } else {
        // None of the previous properties match - inform user
        comparisonSummary = `I checked the ${previouslySuggestedProperties.length} properties I showed you earlier, but none of them have ${accContext.amenities.join(', ') || 'that feature'}. Let me search for properties that do...`;
        // Fall through to normal search below by NOT returning here
        // This allows the code to continue to the AI search section
      }

      // Only return comparison response if we found matches (don't save to ai_searches)
      if (matchingPrevious.length > 0) {
        const comparisonResponse = {
          results: comparisonResults,
          summary: comparisonSummary,
          totalMatches: comparisonResults.length,
          isComparisonResponse: true // Flag for frontend
        };

        const responseContent = JSON.stringify(comparisonResponse);

        // Save only the assistant message, NOT ai_searches
        if (canPersist) {
          await supabase.from('chat_messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: responseContent
          });
        }

        console.log('[Comparison] Returning direct comparison response (no AI call, no ai_searches save)');
        return new Response(JSON.stringify({ response: responseContent }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      // If no matches, continue to normal search flow below
      console.log('[Comparison] No matches in previous properties, continuing to new search');
    }

    // Filter and score ALL properties based on accumulated context
    // Always include all matching properties - don't filter out previously suggested ones
    // Users want to see all relevant results, even if some were shown before
    const basePropertySet = properties;

    const scoredProperties = filterAndScoreProperties(basePropertySet, accContext);
    console.log(`[Filtering] ${scoredProperties.length} properties after filtering (from ${properties.length})`);

    // Take top scored properties directly instead of discarding lower-scored, but still sorted by score
    const topProperties = scoredProperties.slice(0, maxResults + 2);

    // Separate into matching and non-matching buckets for logging only
    const perfectMatches = scoredProperties.filter(p => p.matchScore >= 70);
    const partialMatches = scoredProperties.filter(p => p.matchScore >= 40 && p.matchScore < 70);

    console.log(`[Scoring] Perfect matches: ${perfectMatches.length}, Partial: ${partialMatches.length}`);

    // Build context-aware system prompt
    const constraintsSummary = [];
    if (accContext.city) constraintsSummary.push(`City: ${accContext.city === 'hcm' ? 'Ho Chi Minh City' : 'Hanoi'}`);
    if (accContext.maxPrice) constraintsSummary.push(`Budget: under ${(accContext.maxPrice/1000000).toFixed(0)}M VND/month`);
    if (accContext.wantsCenter) constraintsSummary.push(`Location: City center`);
    if (accContext.amenities.length > 0) constraintsSummary.push(`Required amenities: ${accContext.amenities.join(', ')}`);
    if (accContext.styles.length > 0) constraintsSummary.push(`Style preferences: ${accContext.styles.join(', ')}`);

    // Check if we have center matches when user wants center
    const hasCenterMatches = accContext.wantsCenter && topProperties.some(p => p.locationTier === 'center');
    const hasNearCenterMatches = accContext.wantsCenter && topProperties.some(p => p.locationTier === 'near-center');
    
    let locationNote = '';
    if (accContext.wantsCenter && !hasCenterMatches) {
      if (hasNearCenterMatches) {
        locationNote = `\n\n⚠️ NOTE: No properties found in the city CENTER matching the budget. The results below are from NEAR-CENTER areas which offer good connectivity to the center.`;
      } else if (topProperties.length > 0) {
        locationNote = `\n\n⚠️ NOTE: No properties found in the city CENTER or NEAR-CENTER matching the budget. The results below are from SUBURBAN areas of ${accContext.city === 'hcm' ? 'Ho Chi Minh City' : 'Hanoi'}. These areas offer modern apartments at better prices but require transportation to the center.`;
      }
    }

    // Build previous properties section for comparison queries
    const previousPropertiesSection = isComparisonQuery && scoredPreviousProperties.length > 0
      ? `
🔍 PREVIOUSLY SUGGESTED PROPERTIES (user is asking about these - CHECK THESE FIRST!):
${scoredPreviousProperties.map((p, i) => `
[PREV-${i+1}] ${p.title}
   ID: ${p.id}
   Location: ${p.location}
   Price: ${(p.price/1000000).toFixed(1)}M VND/month
   Amenities: ${p.amenities.join(', ') || 'None listed'}
   Styles: ${p.styles.join(', ') || 'Not specified'}
   Has requested features: ${accContext.amenities.length > 0 ? accContext.amenities.map(a => `${a}: ${p.amenities.some(pa => pa.toLowerCase().includes(a.toLowerCase())) ? '✓ YES' : '✗ NO'}`).join(', ') : 'N/A'}
`).join('\n')}

⚠️ THIS IS A COMPARISON/FILTER QUERY - The user is asking about the properties they've already seen!
`
      : '';

    const systemPrompt = `You are Hausto AI, a friendly and intelligent rental property assistant in Vietnam. You help renters find their perfect home.

🎯 USER'S ACCUMULATED REQUIREMENTS (from this conversation):
${constraintsSummary.length > 0 ? constraintsSummary.map(c => `• ${c}`).join('\n') : '• No specific requirements yet - ask what they\'re looking for!'}
${locationNote}
${previousPropertiesSection}
📊 AVAILABLE PROPERTIES (${topProperties.length} matches from ${properties.length} total - SORTED BY PRIORITY, show in this exact order):
${topProperties.length > 0 ? topProperties.map((p, i) => `
[${i+1}] ${p.matchReasons.some(r => r.includes('exactly')) ? '⭐ EXACT MATCH' : '📍 NEARBY'} ${p.title}
   ID: ${p.id}
   Location: ${p.location} (${p.locationTier})
   Price: ${(p.price/1000000).toFixed(1)}M VND/month ${p.priceMatch ? '✓ within budget' : '⚠️ over budget'}
   Match Score: ${p.matchScore}/100 ${p.matchScore >= 90 ? '🎯 TOP MATCH' : ''}
   Match Reasons: ${p.matchReasons.join(', ') || 'General match'}
   Amenities: ${p.amenities.slice(0, 10).join(', ')}${p.amenities.length > 10 ? '...' : ''}
   Styles: ${p.styles.join(', ') || 'Not specified'}
   Images: ${JSON.stringify(p.images)}
   Realtor ID: ${p.realtor_id}
   ${p.providerName ? `Provider: ${p.providerName} (${p.providerPhone})` : ''}
`).join('\n') : 'No properties currently match these criteria in our database.'}

🧠 CRITICAL INSTRUCTIONS:

1. **COMPARE PREVIOUS RESULTS FIRST** (HIGHEST PRIORITY for comparison queries):
   ${isComparisonQuery ? `
   ⚠️ THIS IS A COMPARISON QUERY - Follow these steps EXACTLY:
   a) Look at the "PREVIOUSLY SUGGESTED PROPERTIES" section above
   b) Check which of those properties have the feature the user is asking about
   c) Start your response by reporting on those specific properties: "Looking at the properties I showed you earlier..."
   d) If the Thao Dien property has a sofa, say "Yes, the Chic Urban Retreat in Thao Dien has a sofa!"
   e) If NONE of the previous properties have it, say "None of the properties I showed you have that. Let me find some that do..."
   f) ONLY THEN show new properties that have the requested feature
   
   DO NOT just run a new search and ignore the previous properties!
   ` : `When user asks about a feature (e.g., "which one has sofa?", "do any of them have balcony?"):
   - FIRST check the previously suggested properties from the chat history for that feature
   - Report which of the PREVIOUS results have that feature
   - ONLY THEN suggest new properties with that feature`}

2. **PRESERVE PROPERTY ORDER - CRITICAL**: The properties are listed above in PRIORITY ORDER (highest match score first). When user asks for a specific area like "Thao Dien":
   - Properties DIRECTLY in Thao Dien MUST appear FIRST in your results
   - Properties in nearby areas (like "District 2") should appear AFTER
   - DO NOT reorder the properties - keep them in the exact order provided above
   - The [1], [2], [3] numbering indicates priority - always return [1] first, then [2], etc.

3. **ALWAYS SHOW AVAILABLE PROPERTIES**: If there are properties listed above, you MUST include them in your response JSON. Never say "I found properties" without showing them.

4. **DETAILED SUMMARIES REQUIRED**: Your summary must explain the search in detail. Instead of just "I found 5 properties", write something like:
   - "I searched for modern apartments in Thao Dien under your 15M budget. I found 3 properties directly in Thao Dien and 2 more in nearby District 2 areas. Properties are sorted with Thao Dien listings first."
   - Explain WHAT you searched for, WHERE you searched, HOW MANY match exactly vs nearby areas

5. **HANDLE "SHOW ME" REQUESTS**: When user says "show me" or similar, immediately return the properties in JSON format. Don't ask more questions.

6. **BE TRANSPARENT ABOUT LOCATION**:
   - If user wanted CENTER but only SUBURBAN available, explain: "I couldn't find center apartments under your budget, but here are great options in [area] which is a modern suburb with good value..."
   - Never pretend suburban is center

7. **RESPECT PRICE CONSTRAINTS**: Never suggest over-budget properties as matches. If including one, clearly mark it as "slightly over budget".

8. **NATURAL MATCH REASONS**: Write conversationally.
   - GOOD: "This cozy 13M/month apartment in Nam Tu Liem has the balcony you wanted. While not in the center, it's in a modern development area with good facilities."
   - BAD: "Property matches criteria."

9. **JSON RESPONSE FORMAT** (REQUIRED for any property search):
{
  "results": [
    {
      "id": "exact-property-id-from-above",
      "title": "Property title",
      "location": "Exact location",
      "price": 12000000,
      "size": "45m²",
      "vibe": "Modern, Cozy",
      "description": "Brief description",
      "highlights": ["Modern", "Balcony"],
      "images": ["copy-exact-urls-from-property-data"],
      "matchScore": 85,
      "matchReason": "Natural reason explaining why this matches, mentioning location honestly",
      "realtor_id": "exact-realtor-id-from-above",
      "isExternal": false,
      "source": null,
      "sourceUrl": null
    }
  ],
  "summary": "Detailed explanation: e.g., 'I searched for cozy apartments in Thao Dien area under 15M VND. I found X properties matching your criteria - Y are directly in Thao Dien, and Z are in nearby District 2 areas. Here are my top recommendations sorted by how closely they match your needs:'",
  "totalMatches": 3
}

8. **FOR CONVERSATIONAL QUERIES**: Only respond without JSON if user is NOT searching for properties (asking about neighborhoods, prices, advice, etc.)

9. **LOCATION KNOWLEDGE**:
   - HCMC Center: District 1, 3 (premium, walkable, expensive ~15-40M)
   - HCMC Near-Center: District 4, 5, Binh Thanh, Phu Nhuan (~10-25M)
   - HCMC Suburban: District 7, 2, Thu Duc (~7-18M, modern, spacious)
   - Hanoi Center: Ba Dinh, Hoan Kiem, Dong Da (historic ~12-35M)
   - Hanoi Near-Center: Hai Ba Trung, Cau Giay, Thanh Xuan, Hoang Mai (~8-20M)
   - Hanoi Suburban: Nam Tu Liem, Bac Tu Liem, Tay Ho, Long Bien, Gia Lam (~6-15M)

Maximum ${maxResults} properties in results.`;

    // Call Lovable AI Gateway with the enhanced prompt
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Build messages with history
    const messagesWithHistory = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-10).map(msg => ({ role: msg.role, content: msg.content })),
      { role: 'user', content: message }
    ];

    console.log('[AI] Calling Lovable AI Gateway with google/gemini-2.5-flash');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: messagesWithHistory,
        max_tokens: 2500,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[AI] Lovable AI error:', aiResponse.status, errorText);
      
      // Handle rate limits
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI service credits exhausted. Please contact support.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 402 }
        );
      }
      
      throw new Error(`AI service error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let responseContent = aiData.choices[0].message.content || '';
    
    console.log('[AI] Raw response length:', responseContent.length);
    
    // Normalize response (remove markdown code fences)
    responseContent = normalizeAiResponse(responseContent);
    
    // Try to extract JSON from the response if it contains JSON-like content
    let extractedJson = null;
    
    // First try direct parse
    try {
      extractedJson = JSON.parse(responseContent);
    } catch {
      // Try to find JSON within the text
      const jsonMatch = responseContent.match(/\{[\s\S]*"results"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
      if (jsonMatch) {
        try {
          extractedJson = JSON.parse(jsonMatch[0]);
          console.log('[AI] Extracted JSON from mixed content');
        } catch {
          console.log('[AI] Failed to extract JSON from mixed content');
        }
      }
    }

    // ========== POST-PROCESSING VALIDATION ==========
    let searchData = null;
    let usedFallback = false;
    
    if (extractedJson && extractedJson.results && Array.isArray(extractedJson.results)) {
      console.log(`[Validation] AI returned ${extractedJson.results.length} results, validating...`);
      
      // Validate and fix AI results
      const validatedResults = validateAndFixAIResults(extractedJson.results, scoredProperties, accContext);
      
      console.log(`[Validation] ${validatedResults.length} results passed validation`);
      
      // Update the response with validated results
      extractedJson.results = validatedResults;
      extractedJson.totalMatches = validatedResults.length;
      
      // If AI returned results that all got filtered out, provide fallback
      if (validatedResults.length === 0 && topProperties.length > 0) {
        console.log('[Validation] All AI results rejected, using fallback from pre-scored properties');
        usedFallback = true;
      } else {
        searchData = extractedJson;
        responseContent = JSON.stringify(extractedJson);
      }
    }
    
    // FALLBACK: If AI didn't return valid JSON or all results were rejected, use pre-scored properties
    if (!searchData && topProperties.length > 0) {
      console.log('[Fallback] Generating results from pre-scored properties');
      usedFallback = true;
      
      const fallbackResults = topProperties.slice(0, maxResults).map(p => ({
        id: p.id,
        title: p.title,
        location: p.location,
        price: p.price,
        size: p.size,
        vibe: p.vibe,
        description: p.description,
        highlights: p.highlights,
        images: p.images,
        matchScore: p.matchScore,
        matchReason: p.matchReasons.length > 0 
          ? p.matchReasons.join('. ') 
          : `Great ${p.styles[0] || 'modern'} apartment in ${p.location.split(',')[0]} at ${(p.price/1000000).toFixed(1)}M VND/month`,
        realtor_id: p.realtor_id,
        isExternal: false,
        source: null,
        sourceUrl: null
      }));
      
      // Generate a summary based on context
      let summary = `I found ${fallbackResults.length} properties`;
      if (accContext.city) {
        summary += ` in ${accContext.city === 'hcm' ? 'Ho Chi Minh City' : 'Hanoi'}`;
      }
      if (accContext.maxPrice) {
        summary += ` under ${(accContext.maxPrice/1000000).toFixed(0)}M VND/month`;
      }
      if (accContext.wantsCenter && !topProperties.some(p => p.locationTier === 'center')) {
        summary += `. Note: No center properties matched your criteria, showing nearby alternatives`;
      }
      summary += '.';
      
      searchData = {
        results: fallbackResults,
        summary: summary,
        totalMatches: fallbackResults.length
      };
      responseContent = JSON.stringify(searchData);
      console.log(`[Fallback] Generated ${fallbackResults.length} property results`);
    }
    
    // If still no search data and no properties, keep the AI's conversational response
    if (!searchData) {
      console.log('[Response] No properties to show, using conversational response');
    }

    // Save response to database
    if (canPersist) {
      await supabase.from('chat_messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: responseContent
      });
    }

    // Save search results for authenticated users
    if (searchData && user?.id && canPersist) {
      try {
        const { data: searchRecord, error: searchError } = await supabase
          .from('ai_searches')
          .insert({
            conversation_id: conversationId,
            user_id: user.id,
            query: message,
            summary: searchData.summary || '',
            total_matches: searchData.results.length
          })
          .select()
          .single();

        if (!searchError && searchRecord && searchData.results.length > 0) {
          const searchResults = searchData.results.map((result: any) => ({
            search_id: searchRecord.id,
            property_id: result.id,
            match_score: result.matchScore,
            match_reason: result.matchReason
          }));

          await supabase.from('ai_search_results').insert(searchResults);
          console.log(`Saved ${searchResults.length} search results`);
        }
      } catch (searchSaveError) {
        console.error('Error saving search results:', searchSaveError);
      }
    }

    // Track AI usage
    if (user?.id && !isAnonymous) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const { data: currentUsage } = await supabase
          .from('daily_usage')
          .select('ai_requests, properties_viewed, properties_matched, quiz_retakes')
          .eq('user_id', user.id)
          .eq('usage_date', today)
          .maybeSingle();

        await supabase.from('daily_usage').upsert({
          user_id: user.id,
          usage_date: today,
          ai_requests: (currentUsage?.ai_requests || 0) + 1,
          properties_viewed: currentUsage?.properties_viewed || 0,
          properties_matched: currentUsage?.properties_matched || 0,
          quiz_retakes: currentUsage?.quiz_retakes || 0,
        }, { onConflict: 'user_id,usage_date' });
      } catch (usageError) {
        console.error('Error tracking usage:', usageError);
      }
    }

    return new Response(JSON.stringify({ response: responseContent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in chat-ai function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Helper to clean AI responses
function normalizeAiResponse(content: string): string {
  if (!content) return '';
  let cleaned = content.trim();

  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    if (firstNewline !== -1) {
      cleaned = cleaned.slice(firstNewline + 1);
    }
  }

  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim();
}
