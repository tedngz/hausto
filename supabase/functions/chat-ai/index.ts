import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { Redis } from "https://esm.sh/@upstash/redis@latest";
import { detectLifestyleIntent, findRelevantKB, formatKBBlock, hasShoppingKeyword } from "../_shared/lifestyle-kb.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Upstash Redis client
const redis = new Redis({
  url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
  token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
});

// ========== WORD-BOUNDARY MATCHING HELPER ==========
// Prevents "d1" from matching "d10", "district 1" from matching "district 10", etc.
function matchesWord(text: string, term: string): boolean {
  // Escape regex special characters in the term
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|[\\s,./;:\\-()\\[\\]\\?!"'])${escaped}(?=$|[\\s,./;:\\-()\\[\\]\\?!"'])`, 'i');
  return regex.test(text);
}

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
    aliases: ['ho chi minh', 'hcm', 'hcmc', 'saigon', 'sài gòn', 'sai gon', 'hồ chí minh', 'tp.hcm', 'tphcm'],
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
  if (LOCATION_DATA.hcm.aliases.some(a => matchesWord(lowerText, a))) return 'hcm';
  for (const tier of Object.values(LOCATION_DATA.hcm.districts)) {
    if (tier.names.some(d => matchesWord(lowerText, d))) return 'hcm';
  }
  // Check HCM sub-districts and roads
  for (const wards of Object.values(HCM_SUBDISTRICTS)) {
    if (wards.some(w => lowerText.includes(w))) return 'hcm';
  }
  for (const road of Object.keys(HCM_ROADS)) {
    if (lowerText.includes(road)) return 'hcm';
  }
  // HCM landmarks (airport, malls, hospitals, etc.)
  const hcmLandmarkKeywords = [
    'tan son nhat', 'tân sơn nhất', 'tsn airport', 'sgn airport', 'saigon airport',
    'ben thanh market', 'chợ bến thành', 'cho ray', 'chợ rẫy', 'rmit',
    'bitexco', 'landmark 81', 'notre dame cathedral', 'nhà thờ đức bà',
    'independence palace', 'dinh độc lập', 'crescent mall', 'takashimaya',
    'aeon mall tan phu', 'aeon tan phu', 'aeon mall binh tan', 'aeon binh tan',
    'saigon centre', 'diamond plaza', 'tao dan park', 'gia dinh park',
    'mien dong bus station', 'mien tay bus station', 'saigon railway station', 'ga sài gòn',
  ];
  if (hcmLandmarkKeywords.some(k => lowerText.includes(k))) return 'hcm';
  
  // Check Hanoi aliases and districts
  if (LOCATION_DATA.hanoi.aliases.some(a => matchesWord(lowerText, a))) return 'hanoi';
  for (const tier of Object.values(LOCATION_DATA.hanoi.districts)) {
    if (tier.names.some(d => matchesWord(lowerText, d))) return 'hanoi';
  }
  for (const wards of Object.values(HANOI_SUBDISTRICTS)) {
    if (wards.some(w => lowerText.includes(w))) return 'hanoi';
  }
  
  // Check Da Nang aliases and districts
  if (LOCATION_DATA.danang.aliases.some(a => matchesWord(lowerText, a))) return 'danang';
  for (const tier of Object.values(LOCATION_DATA.danang.districts)) {
    if (tier.names.some(d => matchesWord(lowerText, d))) return 'danang';
  }
  for (const wards of Object.values(DANANG_SUBDISTRICTS)) {
    if (wards.some(w => lowerText.includes(w))) return 'danang';
  }
  
  return null;
}

function getLocationTier(location: string, city: 'hcm' | 'hanoi' | 'danang'): 'center' | 'near-center' | 'suburban' | 'unknown' {
  const locLower = location.toLowerCase();
  const cityData = LOCATION_DATA[city];
  
  if (cityData.districts.center.names.some(d => matchesWord(locLower, d))) return 'center';
  if (cityData.districts.nearCenter.names.some(d => matchesWord(locLower, d))) return 'near-center';
  if (cityData.districts.suburban.names.some(d => matchesWord(locLower, d))) return 'suburban';
  
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

// Returns canonical bedroom token: "studio", "1", "2", "3", "4+", or null
function parseBedrooms(text: string): string | null {
  const lower = text.toLowerCase();
  // Studio
  if (/\bstudio\b/.test(lower)) return 'studio';
  // Penthouse — treat as its own category, don't conflate with bedroom counts
  // Patterns: "2 bedroom(s)", "2-bedroom", "2br", "2 br", "2bd", "2 phòng ngủ", "2 phong ngu", "2 pn", "2pn"
  const patterns: RegExp[] = [
    /(\d+)\s*\+?\s*(?:bedroom|bed\s*room|bedrooms|bed-?room)s?\b/,
    /(\d+)\s*\+?\s*br\b/,
    /(\d+)\s*\+?\s*bd\b/,
    /(\d+)\s*\+?\s*ph[oòô]ng\s*ng[uủ]/,
    /(\d+)\s*\+?\s*pn\b/,
  ];
  for (const re of patterns) {
    const m = lower.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n >= 1) {
        if (n >= 4) return '4+';
        return String(n);
      }
    }
  }
  // "one bedroom", "two bedrooms"
  const wordMap: Record<string, string> = {
    one: '1', two: '2', three: '3', four: '4+', five: '4+',
    một: '1', hai: '2', ba: '3', bốn: '4+', mot: '1', bon: '4+',
  };
  for (const [w, n] of Object.entries(wordMap)) {
    const re = new RegExp(`\\b${w}\\s+(?:bedroom|bed-?room|ph[oòô]ng\\s*ng[uủ])`, 'i');
    if (re.test(lower)) return n;
  }
  return null;
}

// Check if a property's `rooms` field matches the requested bedroom token
function propertyMatchesBedrooms(roomsField: string | null | undefined, requested: string): boolean {
  if (!roomsField) return false;
  const r = roomsField.toLowerCase().trim();
  if (requested === 'studio') return r.includes('studio');
  if (requested === '4+') {
    // Match 4 Bedrooms, 4+ Bedrooms, 5 Bedrooms, etc.
    const m = r.match(/(\d+)\+?\s*bedroom/);
    if (m) return parseInt(m[1], 10) >= 4;
    return r.includes('4+') || r.includes('penthouse');
  }
  // Exact bedroom count match: "2 Bedrooms" but not "12 Bedrooms"
  const m = r.match(/^(\d+)\s*bedroom/);
  if (m) return m[1] === requested;
  return false;
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
  bedrooms: string | null;  // 'studio' | '1' | '2' | '3' | '4+'
  amenities: string[];
  styles: string[];
  specificDistricts: string[];
  requestedComplexes: string[]; // Specific named projects/complexes (e.g. "vinhomes golden river")
  rejections: string[];   // things the user said they didn't want
  likes: string[];        // things/properties the user reacted positively to
}

// Canonical list of named HCM apartment complexes/projects.
// Used as a HARD filter: when a user mentions one of these by name, only
// properties whose title or location contain that complex name should be returned.
// Keep names lowercase and ordered from most-specific to most-generic so that
// substring checks pick the most specific match first (e.g. "vinhomes golden river"
// must be matched before a generic "vinhomes" or "river" token).
const HCM_COMPLEX_NAMES: string[] = [
  // D1 / D4
  'vinhomes golden river', 'vinhomes ba son', 'the marq',
  'saigon royal', 'the tresor', 'millennium masteri', 'icon 56',
  'rivergate residence', 'rivergate', 'gold view', 'river gate',
  // D7 (Phu My Hung)
  'saigon riverside', 'riverside residence', 'saigon south residences',
  'sky garden', 'happy valley', 'midtown phu my hung', 'scenic valley',
  'the panorama', 'the ascentia', 'urban hill', 'happy residence',
  'riviera point', 'eco green saigon', 'sunrise city',
  // D2 / Thu Duc
  'masteri thao dien', 'masteri an phu', 'gateway thao dien',
  'estella heights', 'the estella', 'the vista an phu', 'thao dien pearl',
  'q2 thao dien', 'lumiere riverside', "d'edge thao dien", 'nassim thao dien',
  'empire city', 'the river thu thiem', 'sala thu thiem', 'new city thu thiem',
  'diamond island', 'the sun avenue', 'the krista',
  'vinhomes grand park', 'centana thu thiem',
  // Binh Thanh
  'vinhomes central park', 'saigon pearl', 'sunwah pearl', 'landmark 81',
  'city garden', 'pearl plaza',
  // Tan Phu / Tan Binh / Phu Nhuan
  'celadon city', 'richstar', 'the botanica', 'botanica premier',
  'cong hoa garden', 'kingston residence', 'orchard garden', 'orchard parkview',
  'newton residence', 'garden gate',
  // D5 / D10 / D11
  'hado centrosa garden', 'centrosa garden', 'rivera park',
  'charmington la pointe', 'the everrich infinity',
];

/**
 * Detect specific named complexes/projects mentioned in user text.
 * Returns the canonical lowercase complex names found.
 * When non-empty, the matching pipeline must HARD-filter properties to only
 * those whose title/location contains the complex name — preventing the AI
 * from confusing e.g. "Vinhomes Golden River" (D1) with "Saigon Riverside" (D7).
 */
function extractRequestedComplexes(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const name of HCM_COMPLEX_NAMES) {
    if (lower.includes(name) && !found.includes(name)) {
      found.push(name);
    }
  }
  // Drop generic shorter matches if a more-specific one was already captured
  // (e.g. don't keep "rivergate" if "rivergate residence" was matched).
  return found.filter(n =>
    !found.some(other => other !== n && other.includes(n) && other.length > n.length)
  );
}

// Extract specific districts/areas mentioned by user (including sub-districts and roads)
function extractSpecificDistricts(text: string): string[] {
  const lowerText = text.toLowerCase();
  const districts: string[] = [];
  
  // HCM main districts
  // Known residential complexes/landmarks → district mapping.
  // IMPORTANT: longer / more specific keys MUST be checked before shorter ones
  // (e.g. "vinhomes golden river" must win over a generic "river" token) — the
  // matching loop iterates in insertion order, so keep specific entries first.
  const HCM_COMPLEXES: Record<string, string> = {
    // ── D1 (Central) ──
    'vinhomes golden river': 'district 1',
    'vinhomes ba son': 'district 1',
    'the marq': 'district 1',
    // ── D4 ──
    'saigon royal': 'district 4',
    'the tresor': 'district 4',
    'millennium masteri': 'district 4',
    'icon 56': 'district 4',
    'rivergate residence': 'district 4',
    'rivergate': 'district 4',
    'gold view': 'district 4',
    'river gate': 'district 4',
    // ── D7 (Phu My Hung) ──
    // NOTE: "saigon riverside" lives in D7 — keep BEFORE any generic "river" key
    'saigon riverside': 'district 7',
    'riverside residence': 'district 7',
    'saigon south residences': 'district 7',
    'sky garden': 'district 7',
    'happy valley': 'district 7',
    'midtown phu my hung': 'district 7',
    'scenic valley': 'district 7',
    'the panorama': 'district 7',
    'the ascentia': 'district 7',
    'urban hill': 'district 7',
    'happy residence': 'district 7',
    'riviera point': 'district 7',
    'eco green saigon': 'district 7',
    'phu my hung': 'district 7',
    'sunrise city': 'district 7',
    'midtown': 'district 7',
    // ── D2 / Thu Duc ──
    'masteri thao dien': 'district 2',
    'masteri an phu': 'district 2',
    'gateway thao dien': 'district 2',
    'estella heights': 'district 2',
    'the estella': 'district 2',
    'the vista an phu': 'district 2',
    'the vista': 'district 2',
    'thao dien pearl': 'district 2',
    'q2 thao dien': 'district 2',
    'lumiere riverside': 'district 2',
    "d'edge thao dien": 'district 2',
    'nassim thao dien': 'district 2',
    'empire city': 'district 2',
    'the river thu thiem': 'district 2',
    'sala thu thiem': 'district 2',
    'new city thu thiem': 'district 2',
    'diamond island': 'district 2',
    'the sun avenue': 'district 2',
    'the krista': 'district 2',
    'vinhomes grand park': 'thu duc',
    'centana thu thiem': 'district 2',
    'sala': 'district 2',
    // ── Binh Thanh ──
    'vinhomes central park': 'binh thanh',
    'saigon pearl': 'binh thanh',
    'sunwah pearl': 'binh thanh',
    'landmark 81': 'binh thanh',
    'city garden': 'binh thanh',
    'the manor': 'binh thanh',
    'pearl plaza': 'binh thanh',
    // ── Tan Phu / Tan Binh / Phu Nhuan ──
    'celadon city': 'tan phu',
    'richstar': 'tan phu',
    'the botanica': 'tan binh',
    'botanica premier': 'tan binh',
    'cong hoa garden': 'tan binh',
    'kingston residence': 'phu nhuan',
    'orchard garden': 'phu nhuan',
    'orchard parkview': 'phu nhuan',
    'newton residence': 'phu nhuan',
    'garden gate': 'phu nhuan',
    // ── D5 / D10 / D11 ──
    'hado centrosa garden': 'district 10',
    'centrosa garden': 'district 10',
    'rivera park': 'district 10',
    'charmington la pointe': 'district 10',
    'the everrich infinity': 'district 5',
  };

  // Famous landmarks (airports, hospitals, universities, malls, parks, markets) → district
  // Critical for queries like "near Tan Son Nhat airport" → Tan Binh, not D2
  const HCM_LANDMARKS: Record<string, string> = {
    // Airports
    'tan son nhat': 'tan binh', 'tân sơn nhất': 'tan binh',
    'tsn airport': 'tan binh', 'sgn airport': 'tan binh', 'saigon airport': 'tan binh',
    'tan son nhat airport': 'tan binh',
    // Markets
    'ben thanh market': 'district 1', 'chợ bến thành': 'district 1',
    'binh tay market': 'district 6', 'chợ bình tây': 'district 6',
    'an dong market': 'district 5',
    // Malls / commercial
    'vincom dong khoi': 'district 1', 'diamond plaza': 'district 1',
    'takashimaya': 'district 1', 'saigon centre': 'district 1',
    'crescent mall': 'district 7', 'sc vivocity': 'district 7',
    'aeon mall tan phu': 'tan phu', 'aeon tan phu': 'tan phu',
    'aeon mall binh tan': 'binh tan', 'aeon binh tan': 'binh tan',
    'parkson hung vuong': 'district 5',
    'estella place': 'district 2',
    // Universities
    'rmit': 'district 7', 'rmit university': 'district 7',
    'university of economics': 'district 1', 'ueh': 'district 1',
    'bach khoa university': 'district 10', 'hcmut': 'district 10',
    'university of medicine': 'district 5',
    // Hospitals
    'cho ray hospital': 'district 5', 'chợ rẫy': 'district 5',
    'fv hospital': 'district 7', 'vinmec central park': 'binh thanh',
    'tam anh hospital': 'tan binh',
    // Parks / landmarks
    'tao dan park': 'district 1', 'công viên tao đàn': 'district 1',
    '23/9 park': 'district 1', '30/4 park': 'district 1',
    'gia dinh park': 'go vap', 'công viên gia định': 'go vap',
    'le van tam park': 'district 1',
    'notre dame cathedral': 'district 1', 'nhà thờ đức bà': 'district 1',
    'independence palace': 'district 1', 'dinh độc lập': 'district 1',
    'bitexco': 'district 1', 'bitexco tower': 'district 1',
    'landmark 81 tower': 'binh thanh',
    'thu thiem bridge': 'district 2',
    // Stations / transit
    'mien dong bus station': 'binh thanh', 'bến xe miền đông': 'binh thanh',
    'mien tay bus station': 'binh tan', 'bến xe miền tây': 'binh tan',
    'saigon railway station': 'district 3', 'ga sài gòn': 'district 3',
  };

  // Check landmark names first (highest priority)
  for (const [landmark, district] of Object.entries(HCM_LANDMARKS)) {
    if (lowerText.includes(landmark)) {
      if (!districts.includes(district)) districts.push(district);
    }
  }

  // Check complex names
  for (const [complex, district] of Object.entries(HCM_COMPLEXES)) {
    if (lowerText.includes(complex)) {
      if (!districts.includes(complex)) districts.push(complex); // Add complex name itself for exact matching
      if (!districts.includes(district)) districts.push(district);
    }
  }
  
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
    { names: ['tan phu', 'tân phú'], canonical: 'tan phu' },
    { names: ['go vap', 'gò vấp'], canonical: 'go vap' },
    { names: ['thu duc', 'thủ đức'], canonical: 'thu duc' },
    { names: ['binh tan', 'bình tân'], canonical: 'binh tan' },
    { names: ['d9', 'district 9', 'quan 9', 'quận 9', 'q9'], canonical: 'district 9' },
    { names: ['d12', 'district 12', 'quan 12', 'quận 12', 'q12'], canonical: 'district 12' },
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
    if (area.names.some(n => matchesWord(lowerText, n))) {
      if (!districts.includes(area.canonical)) {
        districts.push(area.canonical);
      }
    }
  }
  
  // Check sub-areas and add both the sub-area AND its parent district
  for (const area of hcmSubAreas) {
    if (area.names.some(n => matchesWord(lowerText, n))) {
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

// Detect dislikes / rejections in a user message
function extractRejections(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/(don'?t|do not|not) (like|want|need)\s+([a-z0-9\s\-]{2,30})/i, 'avoid: $3'],
    [/no (more|other)?\s*([a-z0-9\s\-]{2,30})/i, 'no $2'],
    [/too (expensive|small|far|noisy|dark|cramped|cheap)/i, 'too $1'],
    [/(skip|remove|hide|exclude)\s+([a-z0-9\s\-]{2,30})/i, 'exclude $2'],
    [/not (interested in|looking for|the right)/i, 'not interested'],
    [/(hate|dislike)\s+([a-z0-9\s\-]{2,30})/i, 'dislikes $2'],
  ];
  for (const [re, label] of patterns) {
    const m = lower.match(re);
    if (m) {
      const rendered = label.replace('$2', m[2] || '').replace('$3', m[3] || '').trim();
      if (rendered && !out.includes(rendered)) out.push(rendered.slice(0, 60));
    }
  }
  return out;
}

// Detect positive signals / likes
function extractLikes(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/(love|like|prefer|want) (the )?([a-z0-9\s\-]{2,30})/i, 'likes $3'],
    [/(perfect|great|nice|good) (for|fit|match)/i, 'positive reaction'],
    [/(this|that) (one|looks) (good|great|perfect|nice)/i, 'positive on shown option'],
    [/show me more like/i, 'wants more like previous'],
  ];
  for (const [re, label] of patterns) {
    const m = lower.match(re);
    if (m) {
      const rendered = label.replace('$3', m[3] || '').trim();
      if (rendered && !out.includes(rendered)) out.push(rendered.slice(0, 60));
    }
  }
  return out;
}

function buildAccumulatedContext(chatHistory: Array<{role: string, content: string}>, currentMessage: string): AccumulatedContext {
  const context: AccumulatedContext = {
    city: null,
    wantsCenter: false,
    locationTier: null,
    maxPrice: null,
    minPrice: null,
    bedrooms: null,
    amenities: [],
    styles: [],
    specificDistricts: [],
    requestedComplexes: [],
    rejections: [],
    likes: []
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
    
    // Bedroom count (most recent user mention wins, so users can change their mind)
    const bedrooms = parseBedrooms(text);
    if (bedrooms) context.bedrooms = bedrooms;
    
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

    // Rejections & likes (accumulate)
    for (const r of extractRejections(text)) {
      if (!context.rejections.includes(r)) context.rejections.push(r);
    }
    for (const l of extractLikes(text)) {
      if (!context.likes.includes(l)) context.likes.push(l);
    }
  }

  // Requested complexes: only honor those mentioned in the CURRENT user message
  // so users can switch projects without sticky filters from earlier in the chat.
  context.requestedComplexes = extractRequestedComplexes(currentMessage);

  // Determine location tier based on center preference
  if (context.wantsCenter) {
    context.locationTier = 'center';
  }
  
  return context;
}

// Summarize long conversation history into a compact memory block.
// Uses Lovable AI Gateway with a fast model. Falls back to empty string on failure.
async function summarizeConversation(
  chatHistory: Array<{role: string, content: string}>
): Promise<string> {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY || chatHistory.length === 0) return '';
  try {
    const transcript = chatHistory
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content).slice(0, 400)}`)
      .join('\n');
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Summarize this rental-property chat into a compact memory the assistant can reuse. Output 4 short bullet sections: Stated preferences, Things rejected/disliked, Properties already discussed (titles only), Open questions still unresolved. Be terse, no filler.'
          },
          { role: 'user', content: transcript }
        ],
      }),
    });
    if (!resp.ok) return '';
    const data = await resp.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.error('[Summary] Failed:', e);
    return '';
  }
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
    // Comparison requests — ONLY when referring to previously shown listings.
    // Plain "compare X vs Y" (e.g. district vs district) is an info question and
    // must go through the normal AI flow so it can return advice blocks.
    /compare (these|them|the (first|second|third|last|listings?|options?|properties|results|ones?))/i,
    /how about the (first|second|third|last|one|listing|property)/i,
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
    // Reasoning-style follow-ups about previously shown options
    /^why\b/i,
    /tell me more about/i,
    /more details on/i,
    /what'?s the difference/i,
    /which (is|one is) (better|cheaper|bigger|closer)/i,
    /pros and cons/i,
    /should i (pick|choose|go with)/i,
    /the (first|second|third|last) one/i,
    /^(option|number) ?\d/i,
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
  rooms?: string;
  vibe_analysis?: any;
  property_source_link?: string;
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
  isExactSubAreaMatch?: boolean;
  // External property flags
  isExternal?: boolean;
  source?: string;
  sourceUrl?: string;
}


function filterAndScoreProperties(
  properties: any[], 
  context: AccumulatedContext
): PropertyWithScore[] {
  const scored: PropertyWithScore[] = [];
  
  for (const p of properties) {
    const locLower = p.location.toLowerCase();
    const titleLowerPre = (p.title || '').toLowerCase();
    
    // Extract amenities: check top-level first, then aggregate from image_analyses
    let amenities = p.vibe_analysis?.amenities || p.amenities || [];
    if ((!amenities || amenities.length === 0) && p.vibe_analysis?.image_analyses) {
      const imageAmenities = new Set<string>();
      for (const img of p.vibe_analysis.image_analyses) {
        if (Array.isArray(img.amenities)) {
          for (const a of img.amenities) imageAmenities.add(a);
        }
      }
      amenities = Array.from(imageAmenities);
    }
    const styles = p.vibe_analysis?.styles || [];
    
    // ========== HARD FILTERS (Eliminate non-matching) ==========
    
    // 1. City filter (STRICT) - exclude properties from ALL other cities.
    // Only consider a property to belong to "another city" if EITHER its location
    // contains that city's alias (e.g. "hà nội"), OR a district token appears as
    // an admin segment (after a comma) — NOT as a street name like
    // "Đường Hai Bà Trưng" inside an HCMC address.
    if (context.city) {
      const matchesAdminDistrict = (loc: string, term: string) => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`,\\s*${escaped}(?=\\s*,|\\s*$)`, 'i').test(loc);
      };
      const otherCities = Object.entries(LOCATION_DATA).filter(([key]) => key !== context.city);
      let isOtherCity = false;
      for (const [, cityData] of otherCities) {
        if (cityData.aliases.some(a => matchesWord(locLower, a)) ||
          Object.values(cityData.districts).some(tier =>
            tier.names.some(d => matchesAdminDistrict(locLower, d))
          )) {
          isOtherCity = true;
          break;
        }
      }
      if (isOtherCity) continue; // Skip properties from wrong city
    }
    
    // 2. Bedroom count (STRICT) — if user specified a bedroom count, only keep matching properties.
    // Properties with no `rooms` data are also filtered out to avoid mismatched results.
    if (context.bedrooms) {
      if (!propertyMatchesBedrooms(p.rooms, context.bedrooms)) {
        continue;
      }
    }

    // 4. Named complex / project (STRICT) — if user named a specific project
    // (e.g. "Vinhomes Golden River"), only keep properties whose title or location
    // contains that exact project name. This prevents the AI from substituting
    // similarly-named properties (e.g. "Saigon Riverside" in D7 for "Vinhomes Golden River" in D1).
    if (context.requestedComplexes && context.requestedComplexes.length > 0) {
      const haystack = `${locLower} ${titleLowerPre}`;
      const matchesAnyComplex = context.requestedComplexes.some(c => haystack.includes(c));
      if (!matchesAnyComplex) {
        continue;
      }
    }


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
      const MAIN_DISTRICT_NAMES = ['district 1', 'district 2', 'district 3', 'district 4', 'district 5', 
        'district 7', 'district 9', 'district 10', 'district 12', 'binh thanh', 'phu nhuan', 'thu duc', 
        'go vap', 'tan binh', 'tan phu', 'binh tan'];
      for (const d of context.specificDistricts) {
        if (MAIN_DISTRICT_NAMES.includes(d)) {
          wantedParentDistricts.add(d);
        }
      }
      
      // Check if property matches any requested specific area (exact match)
      // Also check location AND title for complex/building names (e.g. "Celadon City")
      const searchableText = `${locLower} ${titleLowerPre}`;
      const matchesExactArea = context.specificDistricts.some(district => {
        if (district === 'district 1' && (matchesWord(locLower, 'district 1') || matchesWord(locLower, 'd1') || matchesWord(locLower, 'quan 1') || matchesWord(locLower, 'quận 1'))) return true;
        if (district === 'district 2' && (matchesWord(locLower, 'district 2') || matchesWord(locLower, 'd2') || matchesWord(locLower, 'quan 2') || matchesWord(locLower, 'quận 2'))) return true;
        if (district === 'district 3' && (matchesWord(locLower, 'district 3') || matchesWord(locLower, 'd3') || matchesWord(locLower, 'quan 3') || matchesWord(locLower, 'quận 3'))) return true;
        if (district === 'district 7' && (matchesWord(locLower, 'district 7') || matchesWord(locLower, 'd7') || matchesWord(locLower, 'quan 7') || matchesWord(locLower, 'quận 7'))) return true;
        if (district === 'tan phu' && (locLower.includes('tan phu') || locLower.includes('tân phú'))) return true;
        if (district === 'binh tan' && (locLower.includes('binh tan') || locLower.includes('bình tân'))) return true;
        if (district === 'thao dien' && (locLower.includes('thao dien') || locLower.includes('thảo điền'))) return true;
        if (district === 'da kao' && (locLower.includes('da kao') || locLower.includes('đa kao') || locLower.includes('dakao'))) return true;
        if (district === 'an phu' && (locLower.includes('an phu') || locLower.includes('an phú'))) return true;
        if (district === 'binh thanh' && (locLower.includes('binh thanh') || locLower.includes('bình thạnh'))) return true;
        if (district === 'phu nhuan' && (locLower.includes('phu nhuan') || locLower.includes('phú nhuận'))) return true;
        if (district === 'phu my hung' && (locLower.includes('phu my hung') || locLower.includes('phú mỹ hưng'))) return true;
        if (district === 'thu thiem' && (locLower.includes('thu thiem') || locLower.includes('thủ thiêm'))) return true;
        // Complex/building name match (check both location and title)
        if (searchableText.includes(district)) return true;
        return matchesWord(locLower, district);
      });
      
      // Check if property is in a parent district that user wants
      const matchesParentDistrict = Array.from(wantedParentDistricts).some(parent => {
        if (parent === 'district 1' && (matchesWord(locLower, 'district 1') || matchesWord(locLower, 'quan 1') || matchesWord(locLower, 'quận 1') || matchesWord(locLower, 'd1'))) return true;
        if (parent === 'district 2' && (matchesWord(locLower, 'district 2') || matchesWord(locLower, 'quan 2') || matchesWord(locLower, 'quận 2') || matchesWord(locLower, 'd2'))) return true;
        if (parent === 'district 3' && (matchesWord(locLower, 'district 3') || matchesWord(locLower, 'quan 3') || matchesWord(locLower, 'quận 3') || matchesWord(locLower, 'd3'))) return true;
        if (parent === 'district 7' && (matchesWord(locLower, 'district 7') || matchesWord(locLower, 'quan 7') || matchesWord(locLower, 'quận 7') || matchesWord(locLower, 'd7'))) return true;
        if (parent === 'tan phu' && (locLower.includes('tan phu') || locLower.includes('tân phú'))) return true;
        if (parent === 'binh tan' && (locLower.includes('binh tan') || locLower.includes('bình tân'))) return true;
        if (parent === 'binh thanh' && (locLower.includes('binh thanh') || locLower.includes('bình thạnh'))) return true;
        if (parent === 'phu nhuan' && (locLower.includes('phu nhuan') || locLower.includes('phú nhuận'))) return true;
        return matchesWord(locLower, parent);
      });
      
      // Check if property is an EXACT match to user's requested sub-area (e.g., "Thao Dien" when user asked for Thao Dien)
      const requestedSubAreas = context.specificDistricts.filter(d => 
        !MAIN_DISTRICT_NAMES.includes(d)
      );
      
      const matchesExactSubArea = requestedSubAreas.length > 0 && requestedSubAreas.some(subArea => {
        if (subArea === 'thao dien' && (locLower.includes('thao dien') || locLower.includes('thảo điền'))) return (isExactSubAreaMatch = true);
        if (subArea === 'da kao' && (locLower.includes('da kao') || locLower.includes('đa kao') || locLower.includes('dakao'))) return (isExactSubAreaMatch = true);
        if (subArea === 'an phu' && (locLower.includes('an phu') || locLower.includes('an phú'))) return (isExactSubAreaMatch = true);
        if (subArea === 'phu my hung' && (locLower.includes('phu my hung') || locLower.includes('phú mỹ hưng'))) return (isExactSubAreaMatch = true);
        if (subArea === 'thu thiem' && (locLower.includes('thu thiem') || locLower.includes('thủ thiêm'))) return (isExactSubAreaMatch = true);
        // Complex/building name match (check location AND title)
        if (searchableText.includes(subArea)) return (isExactSubAreaMatch = true);
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
        // NOT in requested districts - HARD EXCLUDE when user specified a district
        console.log(`[Scoring] Property ${p.id} EXCLUDED - not in requested districts: ${p.location}`);
        continue; // Skip this property entirely
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
    
    // Amenity match - check amenities array, description, highlights, and title
    const lowerAmenities = amenities.map((a: string) => a.toLowerCase());
    const descLower = (p.description || '').toLowerCase();
    const titleLower = (p.title || '').toLowerCase();
    const highlightsLower = (p.highlights || []).map((h: string) => h.toLowerCase()).join(' ');
    const allPropertyText = `${descLower} ${titleLower} ${highlightsLower} ${lowerAmenities.join(' ')}`;
    
    // Furniture keywords for inferring "furnished" status
    const FURNITURE_KEYWORDS = [
      'bed', 'sofa', 'couch', 'wardrobe', 'desk', 'table', 'dresser',
      'bookshelf', 'cabinet', 'chair', 'mattress', 'nightstand',
      'bedside table', 'dining table', 'coffee table', 'tv stand',
      'shelving', 'armchair', 'bar stool', 'barstools'
    ];
    
    let amenityMatchCount = 0;
    const matchedAmenities: string[] = [];
    const missingAmenities: string[] = [];
    for (const reqAmenity of context.amenities) {
      // Check amenities array first, then fall back to description/title/highlights
      const inAmenities = lowerAmenities.some((a: string) => a.includes(reqAmenity) || reqAmenity.includes(a));
      const inText = allPropertyText.includes(reqAmenity);
      
      // Special handling for "furnished": infer from furniture amenities
      let furnishedInferred = false;
      if (reqAmenity === 'furnished' && !inAmenities && !inText) {
        const furnitureCount = lowerAmenities.filter((a: string) => 
          FURNITURE_KEYWORDS.some(kw => a.includes(kw))
        ).length;
        if (furnitureCount >= 2) {
          furnishedInferred = true;
        }
      }
      
      if (inAmenities || inText || furnishedInferred) {
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
      rooms: p.rooms || null,
      vibe_analysis: p.vibe_analysis || null,
      property_source_link: p.property_source_link || p._sourceUrl || null,
      providerName: p.property_source_provider_name || p.contact_name || null,
      providerPhone: p.property_source_provider_phone || p.contact_phone || null,
      matchScore: score,
      priceMatch,
      locationMatch,
      amenityMatchCount,
      styleMatchCount,
      locationTier,
      matchReasons,
      isExactSubAreaMatch,
      isExternal: !!p._isExternal,
      source: p._source || null,
      sourceUrl: p._sourceUrl || null,
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
      title: actualProperty.title,
      size: actualProperty.size,
      vibe: actualProperty.vibe,
      description: actualProperty.description,
      price: actualProperty.price,
      location: actualProperty.location,
      images: actualProperty.images,
      realtor_id: actualProperty.realtor_id,
      matchScore: actualProperty.matchScore,
      amenities: actualProperty.amenities,
      highlights: actualProperty.highlights,
      vibe_analysis: actualProperty.vibe_analysis || null,
      rooms: actualProperty.rooms || null,
      property_source_link: actualProperty.property_source_link || null,
      sourceProviderName: actualProperty.providerName || null,
      sourceProviderPhone: actualProperty.providerPhone || null,
      isExternal: !!actualProperty.isExternal,
      source: actualProperty.source || null,
      sourceUrl: actualProperty.sourceUrl || null,
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
    // Cross-project: function may run on a different Supabase project than the
    // database/auth. See ../_shared/db-client.ts.
    const {
      getDbUrl,
      getDbServiceRoleKey,
      getDbAnonKey,
      getDbPublishableKey,
    } = await import("../_shared/db-client.ts");
    const supabaseUrl = getDbUrl();
    const supabaseServiceKey = getDbServiceRoleKey();
    const supabaseAnonKey = getDbAnonKey();
    const supabasePublishableKey = getDbPublishableKey();
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check for authentication (optional for anonymous users)
    const authHeader = req.headers.get('authorization');
    let user = null;
    let isAnonymous = false;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');

      // Skip if the token is just the anon/publishable key (not a user JWT)
      const isAnonKey = token === supabaseAnonKey || token === supabasePublishableKey;

      if (!isAnonKey && token.length > 100) {
        // SECURITY: verify JWT signature with Supabase auth instead of trusting client-decoded payload
        try {
          const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
          const { data: { user: verifiedUser }, error: verifyError } = await supabaseAuth.auth.getUser(token);
          if (verifyError || !verifiedUser) {
            console.log('JWT verification failed, treating as anonymous:', verifyError?.message);
            isAnonymous = true;
          } else {
            user = { id: verifiedUser.id, email: verifiedUser.email || null };
            console.log('Authenticated user from verified JWT:', user.id);
          }
        } catch (decodeError: any) {
          console.log('Failed to verify JWT, treating as anonymous. Error:', decodeError?.message);
          isAnonymous = true;
        }
      } else {
        console.log('Anon key detected, treating as anonymous user');
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

    const { message: rawMessage, conversationId, userType, userPreferences, propertyImages } = parsedBody;
    
    // Strip [Ask] or [Search] prefixes so the AI treats them as natural questions
    let message = (rawMessage || '').replace(/^\[(?:Ask|Search)\]\s*/i, '').trim();
    message = message.replace(/Follow-up:\s*\[(?:Ask|Search)\]\s*/i, 'Follow-up: ').trim();
    // Process uploaded images for style detection
    const validImages: string[] = Array.isArray(propertyImages) 
      ? propertyImages.filter((img: string) => typeof img === 'string' && img.startsWith('data:image/'))
      : [];
    
    console.log('Request data:', { 
      messageLength: message?.length, 
      conversationId, 
      userType, 
      hasPreferences: !!userPreferences,
      hasPropertyImages: validImages.length > 0,
      imageCount: validImages.length,
      isAnonymous
    });

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Fetch active internal properties
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    
    const [internalResult, externalResult] = await Promise.all([
      supabase
        .from('properties')
        .select('*')
        .eq('is_active', true),
        // .gte('last_activated_at', tenDaysAgo.toISOString()),
      supabase
        .from('external_properties')
        .select('*')
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('crawled_at', { ascending: false })
        .limit(500)
    ]);

    if (internalResult.error) {
      console.error('Error fetching internal properties:', internalResult.error);
      throw internalResult.error;
    }
    
    // Transform external properties to match internal property shape
    const externalProperties = (externalResult.data || []).map((ext: any) => ({
      id: ext.id, // Use real UUID so ai_search_results FK works
      title: ext.title,
      location: ext.location,
      price: Number(ext.price) || 0,
      size: ext.size || null,
      vibe: ext.vibe || null,
      description: ext.description || null,
      highlights: ext.highlights || [],
      amenities: ext.amenities || [],
      images: ext.images || [],
      realtor_id: `ext-${ext.source}`, // Synthetic realtor ID for external
      vibe_analysis: ext.vibe_analysis || {},
      created_at: ext.created_at,
      last_activated_at: ext.crawled_at,
      is_active: true,
      rooms: ext.rooms || null,
      property_source_link: ext.source_url,
      property_source_provider_name: ext.contact_name || null,
      property_source_provider_phone: ext.contact_phone || null,
      latitude: ext.latitude,
      longitude: ext.longitude,
      _isExternal: true, // Internal flag for later use
      _source: ext.source,
      _sourceUrl: ext.source_url,
    }));
    
    const properties = [...(internalResult.data || []), ...externalProperties];
    console.log(`Found ${internalResult.data?.length || 0} internal + ${externalProperties.length} external = ${properties.length} total properties`);

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
        .limit(40); // Wider history window for better long-conversation memory

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

    const sanitizedChatHistory = chatHistory.map(msg => {
      if (msg.role === 'assistant') {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.results) {
            return {
              role: 'assistant',
              content: JSON.stringify({
                blocks: parsed.blocks || [],
                _system_note: "[Results omitted to save tokens. They are stored in DB.]"
              })
            };
          }
        } catch (e) {
          // Ignored
        }
      }
      return msg;
    });

    // ========== REALTOR MODE ==========
    if (userType === 'realtor') {
      const systemPrompt = `You are Hausto AI, a helpful assistant for real estate professionals. You help realtors create compelling property descriptions, titles, and marketing content.

STANDARD PROPERTY HIGHLIGHTS:
Style Tags: Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage
Amenity Tags: Pet Friendly, Gym Access, Pool, Parking, Balcony, Garden, Elevator, Security, WiFi, Furnished, Air Conditioning, Washing Machine
Location Tags: City Center, Quiet Neighborhood, Near Metro, Shopping Nearby, School District, Business District
Feature Tags: High Ceilings, Natural Light, Open Plan, Walk-in Closet, En-suite Bathroom, Kitchen Island, Hardwood Floors

When analyzing property images, ONLY use tags from the standard list above.`;

      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
      if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
          ],
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI error:', response.status, errorText);
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

      return new Response(JSON.stringify({ 
        response: aiResponse
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // ========== RENTER MODE - Enhanced AI Search ==========
    
    // Build accumulated context from conversation history
    const accContext = buildAccumulatedContext(chatHistory, message);

    // Kick off conversation summary in PARALLEL (don't block the main AI call).
    // We only consume the summary if it resolves quickly; otherwise we skip it
    // for this turn — long-term context is still preserved by accContext.
    const summaryPromise: Promise<string> = chatHistory.length > 20
      ? summarizeConversation(chatHistory.slice(0, -20)).catch(() => '')
      : Promise.resolve('');
    
    // ========== IMAGE STYLE DETECTION ==========
    // If user uploaded reference images, analyze them to detect styles/vibes
    let imageAnalysisResult: { styles: string[], colors: string[], description: string } | null = null;
    
    if (validImages.length > 0) {
      console.log(`[Image Analysis] Analyzing ${validImages.length} uploaded images for style detection`);
      
      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
      if (OPENAI_API_KEY) {
        try {
          const imageContentParts: any[] = validImages.map((img: string) => ({
            type: 'image_url',
            image_url: { url: img }
          }));
          
          const imageAnalysisResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { 
                  role: 'system', 
                  content: `You are a property style analyzer. Analyze the uploaded interior/exterior images and identify the design styles, colors, and vibe. 
                  
RESPOND IN EXACTLY THIS JSON FORMAT (no markdown, no extra text):
{"styles":["Modern","Minimalist"],"colors":["Neutral","White"],"description":"Brief 1-sentence description of the overall aesthetic"}

Use ONLY these style options: Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage
Use ONLY these color options: Neutral, Warm, Cool, Bright, Dark, Colorful, Natural, White, Earth, Bold
Pick 1-3 styles and 1-2 colors that best match.` 
                },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: 'Analyze these reference images and detect the interior design style, color palette, and overall vibe.' },
                    ...imageContentParts
                  ]
                }
              ],
              max_tokens: 300,
            }),
          });

          if (imageAnalysisResponse.ok) {
            const analysisData = await imageAnalysisResponse.json();
            let analysisContent = analysisData.choices?.[0]?.message?.content || '';
            analysisContent = normalizeAiResponse(analysisContent);
            
            try {
              imageAnalysisResult = JSON.parse(analysisContent);
              console.log('[Image Analysis] Detected styles:', imageAnalysisResult?.styles, 'colors:', imageAnalysisResult?.colors);
              
              // Merge detected styles into accumulated context
              if (imageAnalysisResult?.styles) {
                for (const style of imageAnalysisResult.styles) {
                  const lowerStyle = style.toLowerCase();
                  if (!accContext.styles.includes(lowerStyle)) {
                    accContext.styles.push(lowerStyle);
                  }
                }
              }

              // Persist analysis onto the latest user message metadata so subsequent
              // turns retain memory of "user previously uploaded a Modern reference".
              if (canPersist && imageAnalysisResult) {
                try {
                  const { data: latestUserMsg } = await supabase
                    .from('chat_messages')
                    .select('id, metadata')
                    .eq('conversation_id', conversationId)
                    .eq('role', 'user')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  if (latestUserMsg?.id) {
                    const newMetadata = {
                      ...(latestUserMsg.metadata || {}),
                      imageAnalysis: {
                        styles: imageAnalysisResult.styles,
                        colors: imageAnalysisResult.colors,
                        description: imageAnalysisResult.description,
                      },
                    };
                    await supabase
                      .from('chat_messages')
                      .update({ metadata: newMetadata })
                      .eq('id', latestUserMsg.id);
                  }
                } catch (metaErr) {
                  console.error('[Image Analysis] Failed to persist metadata:', metaErr);
                }
              }
            } catch (parseErr) {
              console.error('[Image Analysis] Failed to parse analysis result:', analysisContent);
            }
          } else {
            console.error('[Image Analysis] API call failed:', imageAnalysisResponse.status);
          }
        } catch (imgError) {
          console.error('[Image Analysis] Error analyzing images:', imgError);
        }
      }
    }
    
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

    // Take top scored properties, but guarantee external listings get representation
    // so they aren't starved out by internal listings that score similarly.
    const topSize = maxResults + 2;
    const allTop = scoredProperties.slice(0, topSize);
    const externalsInScored = scoredProperties.filter(p => p.isExternal);
    const externalsInTop = allTop.filter(p => p.isExternal).length;
    const externalQuota = Math.min(3, externalsInScored.length);

    let topProperties = allTop;
    if (externalsInTop < externalQuota && externalsInScored.length > 0) {
      const topExternals = externalsInScored.slice(0, externalQuota);
      const topInternals = scoredProperties
        .filter(p => !p.isExternal)
        .slice(0, topSize - externalQuota);
      topProperties = [...topInternals, ...topExternals].sort((a, b) => {
        if (a.isExactSubAreaMatch !== b.isExactSubAreaMatch) return a.isExactSubAreaMatch ? -1 : 1;
        return b.matchScore - a.matchScore;
      });
    }
    console.log(`[Filtering] externals in scored=${externalsInScored.length}, in topProperties=${topProperties.filter(p => p.isExternal).length}`);

    // Separate into matching and non-matching buckets for logging only
    const perfectMatches = scoredProperties.filter(p => p.matchScore >= 70);
    const partialMatches = scoredProperties.filter(p => p.matchScore >= 40 && p.matchScore < 70);

    console.log(`[Scoring] Perfect matches: ${perfectMatches.length}, Partial: ${partialMatches.length}`);

    // Build context-aware system prompt
    const constraintsSummary = [];
    if (accContext.city) constraintsSummary.push(`City: ${accContext.city === 'hcm' ? 'Ho Chi Minh City' : 'Hanoi'}`);
    if (accContext.maxPrice) constraintsSummary.push(`Budget: under ${(accContext.maxPrice/1000000).toFixed(0)}M VND/month`);
    if (accContext.bedrooms) {
      const label = accContext.bedrooms === 'studio' ? 'Studio'
        : accContext.bedrooms === '4+' ? '4+ bedrooms'
        : `${accContext.bedrooms} bedroom${accContext.bedrooms === '1' ? '' : 's'}`;
      constraintsSummary.push(`Bedrooms: ${label} (STRICT — do NOT include other bedroom counts)`);
    }
    if (accContext.wantsCenter) constraintsSummary.push(`Location: City center`);
    if (accContext.specificDistricts.length > 0) constraintsSummary.push(`Specific areas: ${accContext.specificDistricts.join(', ')}`);
    if (accContext.requestedComplexes.length > 0) constraintsSummary.push(`Specific project/complex: ${accContext.requestedComplexes.join(', ')} (STRICT — only recommend properties IN this exact project; do NOT suggest similarly-named projects in other districts)`);
    if (accContext.amenities.length > 0) constraintsSummary.push(`Required amenities: ${accContext.amenities.join(', ')}`);
    if (accContext.styles.length > 0) constraintsSummary.push(`Style preferences: ${accContext.styles.join(', ')}`);
    if (imageAnalysisResult) {
      constraintsSummary.push(`🖼️ Image analysis detected: styles=[${imageAnalysisResult.styles.join(', ')}], colors=[${imageAnalysisResult.colors.join(', ')}] - "${imageAnalysisResult.description}"`);
    }
    const rejectionsBlock = accContext.rejections.length > 0
      ? `\n🚫 USER HAS REJECTED / DISLIKED:\n${accContext.rejections.map(r => `• ${r}`).join('\n')}\nNever re-suggest options matching these.`
      : '';
    const likesBlock = accContext.likes.length > 0
      ? `\n💚 USER REACTED POSITIVELY TO:\n${accContext.likes.map(l => `• ${l}`).join('\n')}\nLean into these signals when ranking.`
      : '';
    // Wait at most 800ms for the parallel summary; otherwise skip it this turn.
    const conversationSummary = await Promise.race([
      summaryPromise,
      new Promise<string>(resolve => setTimeout(() => resolve(''), 800)),
    ]);
    if (conversationSummary) console.log('[Summary] Generated', conversationSummary.length, 'chars');
    const summaryBlock = conversationSummary
      ? `\n🧠 EARLIER CONVERSATION SUMMARY:\n${conversationSummary}\n`
      : '';

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

    // ========== KNOWLEDGE BLOCKS for richer answers (complex/district/distance) ==========
    const lowerMsg = (message || '').toLowerCase();

    // Static neighborhood distance table — model must use ONLY these values.
    const KNOWN_DISTANCES: Array<{ from: string; to: string; km: number; driveMinutes: number; bikeMinutes: number; notes?: string }> = [
      // HCMC
      { from: 'Thao Dien', to: 'District 1', km: 7,  driveMinutes: 20, bikeMinutes: 25, notes: 'Via Saigon Bridge; heavy at rush hour' },
      { from: 'Thao Dien', to: 'Thu Thiem', km: 4,  driveMinutes: 12, bikeMinutes: 15 },
      { from: 'Thu Thiem', to: 'District 1', km: 2,  driveMinutes: 8,  bikeMinutes: 10, notes: 'Across Thu Thiem Tunnel' },
      { from: 'Phu My Hung', to: 'District 1', km: 8, driveMinutes: 25, bikeMinutes: 30, notes: 'Via Nguyen Van Linh / Khanh Hoi' },
      { from: 'Binh Thanh', to: 'District 1', km: 4, driveMinutes: 15, bikeMinutes: 18 },
      { from: 'District 3', to: 'District 1', km: 3, driveMinutes: 10, bikeMinutes: 12 },
      { from: 'District 7', to: 'District 1', km: 8, driveMinutes: 25, bikeMinutes: 30 },
      { from: 'Thu Duc', to: 'District 1', km: 14, driveMinutes: 35, bikeMinutes: 45 },
      // Hanoi
      { from: 'Tay Ho', to: 'Hoan Kiem', km: 4, driveMinutes: 15, bikeMinutes: 18 },
      { from: 'Cau Giay', to: 'Hoan Kiem', km: 7, driveMinutes: 22, bikeMinutes: 28 },
      { from: 'Nam Tu Liem', to: 'Hoan Kiem', km: 12, driveMinutes: 30, bikeMinutes: 40 },
      { from: 'Ba Dinh', to: 'Hoan Kiem', km: 3, driveMinutes: 10, bikeMinutes: 12 },
      { from: 'Long Bien', to: 'Hoan Kiem', km: 5, driveMinutes: 18, bikeMinutes: 20, notes: 'Across Chuong Duong Bridge' },
    ];

    // Best-effort lookup of complexes the user named.
    let knownComplexes: any[] = [];
    try {
      const { data: cxList } = await supabase
        .from('complexes')
        .select('id, slug, name, city, district, developer, management_company, year_completed, pet_policy, amenities, average_rent_brackets, insider_pros, insider_cons, commute_times, aliases, tags')
        .eq('is_published', true)
        .limit(80);
      if (cxList && cxList.length > 0) {
        knownComplexes = cxList.filter((c: any) => {
          const nameLc = (c.name || '').toLowerCase();
          const aliases = Array.isArray(c.aliases) ? c.aliases.map((a: string) => (a || '').toLowerCase()) : [];
          return (nameLc && lowerMsg.includes(nameLc)) ||
                 aliases.some((a: string) => a && lowerMsg.includes(a));
        }).slice(0, 3);
      }
    } catch (e) {
      console.log('[Knowledge] complexes lookup skipped:', (e as Error).message);
    }

    const knownComplexesBlock = knownComplexes.length > 0
      ? `\n🏢 KNOWN COMPLEXES MATCHING THE USER'S MESSAGE (use these verbatim; do NOT invent fields):\n${knownComplexes.map((c: any) => `- name: ${c.name}
  city: ${c.city}
  district: ${c.district}
  developer: ${c.developer || 'unknown'}
  management: ${c.management_company || 'unknown'}
  year_completed: ${c.year_completed || 'unknown'}
  pet_policy: ${c.pet_policy || 'unknown'}
  amenities: ${(c.amenities || []).slice(0, 12).join(', ') || 'unknown'}
  rent_brackets_usd: ${c.average_rent_brackets ? JSON.stringify(c.average_rent_brackets) : 'unknown'}
  insider_pros: ${(c.insider_pros || []).join(' | ') || 'unknown'}
  insider_cons: ${(c.insider_cons || []).join(' | ') || 'unknown'}
  commute_times: ${c.commute_times ? JSON.stringify(c.commute_times) : 'unknown'}`).join('\n\n')}\n`
      : '';

    const knownDistancesBlock = `\n📐 KNOWN NEIGHBORHOOD DISTANCES (use ONLY for pairs in this table; omit km/minutes for anything not listed):\n${KNOWN_DISTANCES.map(d => `- ${d.from} ↔ ${d.to}: ${d.km}km, ~${d.driveMinutes}min drive, ~${d.bikeMinutes}min motorbike${d.notes ? ` (${d.notes})` : ''}`).join('\n')}\n`;

    // ========== LIFESTYLE INTENT + KB LOOKUP ==========
    const intent = detectLifestyleIntent(message);
    const shoppingOverride = hasShoppingKeyword(message);
    // Pure-lifestyle ONLY when detector says so AND there's no shopping keyword
    const isPureLifestyle = intent.isLifestyle && !shoppingOverride;
    
    if (shoppingOverride && intent.isLifestyle) {
      intent.isMixed = true;
    }

    const kbLookup = (isPureLifestyle || intent.isMixed)
      ? findRelevantKB(message, accContext as any)
      : { cityEntries: [], districtEntries: [] };
    const lifestyleKBBlock = formatKBBlock(kbLookup);
    console.log(
      `[AI] intent: lifestyle=${intent.isLifestyle} mixed=${intent.isMixed} ` +
      `shoppingOverride=${shoppingOverride} pureLifestyle=${isPureLifestyle} ` +
      `kb_hits=city:${kbLookup.cityEntries.length}/districts:${kbLookup.districtEntries.length}`
    );

    // On pure lifestyle turns, drop the property block from the prompt to save
    // tokens and prevent the model from forcing listings into the answer.
    const promptProperties = isPureLifestyle ? [] : topProperties;


    const systemPrompt = `You are Hausto AI, a friendly, sharp, and trustworthy rental property advisor in Vietnam. You reason carefully about what the user actually needs across the whole conversation, not just the latest message.

🎯 USER'S ACCUMULATED REQUIREMENTS (from this conversation):
${constraintsSummary.length > 0 ? constraintsSummary.map(c => `• ${c}`).join('\n') : '• No specific requirements yet - ask what they\'re looking for!'}
${rejectionsBlock}${likesBlock}${summaryBlock}${locationNote}
${knownComplexesBlock}${knownDistancesBlock}${lifestyleKBBlock}
${previousPropertiesSection}
🪜 BEFORE YOU RESPOND, REASON THROUGH:
1. Is this a NEW search or a FOLLOW-UP about properties already shown? (Check PREVIOUSLY SUGGESTED PROPERTIES section.)
2. Did the user reject anything I should now avoid? Filter those out.
3. Are there positive signals (likes) I should weight higher?
4. Is there an open question or ambiguity I should clarify briefly before listing properties?
5. Does my final ordering respect the priority list below and the user's stated preferences?
6. Is the user actually shopping, or asking a LIFESTYLE / INFO question (vibe, cost of living, best area for X, safety, schools, commute, "tell me about")? If the latter, answer from LIFESTYLE KNOWLEDGE in prose blocks — do NOT return "results".

${isPureLifestyle ? `💡 LIFESTYLE / INFO TURN — The user is asking for advice or local knowledge, NOT shopping. Respond using ONLY the "blocks" shape (text + optional district/complex/distance + followups). DO NOT return a "results" array. Keep prose conversational, 3–6 sentences, grounded in LIFESTYLE KNOWLEDGE above. You MUST include a separate block of type "followups" containing 2–4 suggestions mixing "[Ask]" and "[Search]". DO NOT put these suggestions inside the "text" block body.` : ''}
${intent.isMixed ? `🔀 MIXED TURN — The user wants BOTH lifestyle context AND listings. You MUST return a "results" array with matching property cards AND a "blocks" array. Inside "blocks", include a "text" block (2–4 sentences) AND a separate "followups" block. Both results and blocks are required.` : ''}
${!isPureLifestyle && !intent.isMixed && promptProperties.length > 0 ? `🛒 SHOPPING TURN — Property candidates are listed below. You MUST include a "results" array with these properties (in the given priority order). Omit "results" ONLY if the user explicitly said "don't show listings" or "just tell me".` : ''}

📊 AVAILABLE PROPERTIES (${promptProperties.length} matches from ${properties.length} total - SORTED BY PRIORITY, show in this exact order):
${promptProperties.length > 0 ? promptProperties.map((p, i) => `
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
`).join('\n') : (isPureLifestyle ? '(Skipped — lifestyle/info turn, no listings needed.)' : 'No properties currently match these criteria in our database.')}


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
   - WHEN USER UPLOADS REFERENCE IMAGES: Start your summary with the image analysis FIRST, then describe what you searched. Keep it simple and concise. For example: "I detected a Modern, Minimalist style with Neutral, White tones from your image. Here are X matching apartments in [area] under [budget]." Do NOT use markdown bold (**). Do NOT repeat or rephrase the same information multiple times. Keep the response short and direct.

5. **HANDLE "SHOW ME" REQUESTS**: When user says "show me" or similar, immediately return the properties in JSON format. Don't ask more questions.

6. **BE TRANSPARENT ABOUT LOCATION**:
   - If user wanted CENTER but only SUBURBAN available, explain: "I couldn't find center apartments under your budget, but here are great options in [area] which is a modern suburb with good value..."
   - Never pretend suburban is center

7. **RESPECT PRICE CONSTRAINTS**: Never suggest over-budget properties as matches. If including one, clearly mark it as "slightly over budget".

8. **NATURAL MATCH REASONS**: Write conversationally. Use commas (not periods/dots) to separate points within a matchReason.
   - GOOD: "in city center, has balcony and furnished, modern style"
   - GOOD: "This cozy 13M/month apartment in Nam Tu Liem has the balcony you wanted, while not in the center it's in a modern development area"
   - BAD: "in city center. has balcony. modern style" (don't use dots between points)
   - BAD: "Property matches criteria."
   
   **AMENITY ACCURACY**: Check the property's full amenities list, description, title, AND highlights before saying a property does or doesn't have something. A property is considered furnished if "Furnished" or "Fully Furnished" appears anywhere in the amenities, highlights, or description, OR if the property has multiple furniture items (e.g., Bed, Sofa, Wardrobe, Desk, Table, Chair) in its amenities list. Never say a property is "not furnished" when it clearly has furniture amenities listed.

9. **JSON RESPONSE FORMAT** — Always return ONE JSON object. Pick the right shape based on the user's intent:

   ⚠️ **DEFAULT TO SHOPPING.** If property candidates are listed in AVAILABLE PROPERTIES above (count > 0) and the user has not explicitly said "just tell me / don't show listings / no listings", you MUST include a "results" array with those property cards. Omit "results" ONLY on pure info turns where AVAILABLE PROPERTIES is empty/skipped.

   A. SHOPPING / SEARCH intent (user wants apartments) → include "results" with property cards AND "blocks" with followups (and optional text/info):
   {
     "results": [
       {
         "id": "exact-property-id-from-above",
         "matchReason": "Natural reason explaining why this matches, mentioning location honestly"
       }
     ],
     "summary": "Short prose intro for the listings (e.g., 'Here are 3 cozy Thao Dien apartments under 15M VND').",
     "totalMatches": 3,
     "blocks": [ { "type": "followups", "suggestions": ["[Search] Same area under 12M", "[Ask] What is Binh Thanh like?", "[Search] 2BR with balcony in Binh Thanh"] } ]
   }

   B. INFO intent (user asks about a complex, district, distance, or wants advice — NOT shopping) → return "blocks" only (MUST include "text" and "followups"), omit "results":
   {
     "blocks": [
       { "type": "text",     "body": "Plain-text advice or answer, 2–5 sentences." },
       { "type": "complex",  "name": "Masteri Thao Dien", "city": "ho chi minh", "district": "Thao Dien",
                             "developer": "Masterise Homes", "management": "Savills",
                             "yearCompleted": 2018, "petPolicy": "Cats allowed, no dogs" },
       { "type": "district", "city": "ho chi minh", "district": "District 2 / Thao Dien",
                             "vibe": "Leafy expat enclave with international schools and riverside dining.",
                             "bestFor": ["families","long-stay expats","walkable cafes"],
                             "tradeoffs": ["heavy bridge traffic to D1","premium pricing"],
                             "notableComplexes": ["Masteri Thao Dien","The Estella","The Vista"] },
       { "type": "distance", "from": "Thao Dien", "to": "District 1",
                             "km": 7, "driveMinutes": 20, "bikeMinutes": 25,
                             "notes": "Via Saigon Bridge; rush hour can double this." },
       { "type": "followups","suggestions": ["[Search] 1BR under 15M in Thao Dien","[Ask] Compare Thao Dien vs Phu My Hung for families"] }
     ]
   }

   Rules for blocks:
   - Use the "complex" / "distance" blocks ONLY when the matching fact is in KNOWN COMPLEXES or KNOWN NEIGHBORHOOD DISTANCES above (or in the LOCATION KNOWLEDGE section). Omit any field you cannot support — NEVER invent year_completed, prices, or commute minutes.
   - "district" blocks may use the LOCATION KNOWLEDGE section and general knowledge of HCMC/Hanoi neighborhoods, but keep claims conservative.
   - "followups" are 2–4 short, tappable next-question suggestions phrased as the user would say them. You MUST put them in a separate block of type "followups", NEVER inside the "text" body. EVERY suggestion MUST begin with one of these intent tags so the UI can render the right icon:
       • "[Search] ..." — tapping will fetch property listings (filters, budgets, bedrooms, specific complexes, "show me", "find").
       • "[Ask] ..." — tapping returns advice/info only (district comparisons, pet policy, commute, "tell me about", "is X good for Y").
   - **ALWAYS include a "followups" block** — on EVERY response, whether shopping or info. For shopping turns, suggest refinements like narrowing budget, different bedroom count, nearby districts, or asking about a neighborhood. For info turns, mix [Ask] and [Search] suggestions.
   - **ALWAYS include a conversational answer** in the "summary" field or a "text" block if the user is asking an informational question. Never leave the user hanging without a text explanation.
   - You may MIX A and B: a shopping turn can also carry a "text" block ("Heads up: under 15M in D1 is rare — these are mostly studios") or a "followups" block.
   - If you only have a quick conversational reply (clarifying question, simple advice), return { "summary": "...", "blocks": [ { "type": "followups", "suggestions": ["[Search] ...", "[Ask] ..."] } ] } with no "results".

10. **WHEN to use which intent**: shopping → user says "show me", "find", "any 2BR", uploads images, gives budget/area/feature filters. Info → user asks "tell me about X", "what's it like in Y", "how far is A from B", "should I pick X or Y", "is X pet friendly". Mixed → "show me 2BRs in Thao Dien and tell me about the area" → include both results and blocks.

11. **LOCATION KNOWLEDGE**:
   - HCMC Center: District 1, 3 (premium, walkable, expensive ~15-40M)
   - HCMC Near-Center: District 4, 5, Binh Thanh, Phu Nhuan (~10-25M)
   - HCMC Suburban: District 7, 2, Thu Duc (~7-18M, modern, spacious)
   - Hanoi Center: Ba Dinh, Hoan Kiem, Dong Da (historic ~12-35M)
   - Hanoi Near-Center: Hai Ba Trung, Cau Giay, Thanh Xuan, Hoang Mai (~8-20M)
   - Hanoi Suburban: Nam Tu Liem, Bac Tu Liem, Tay Ho, Long Bien, Gia Lam (~6-15M)

Maximum ${maxResults} properties in results.`;

    // Call OpenAI directly with gpt-4o-mini.
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

    // Build messages with history - include images as multimodal content if present
    const userMessageContent: any = validImages.length > 0
      ? [
          { type: 'text', text: message + (imageAnalysisResult ? `\n\n[User uploaded reference images showing ${imageAnalysisResult.styles.join(', ')} style with ${imageAnalysisResult.colors.join(', ')} colors. Find properties matching this aesthetic.]` : '') },
          ...validImages.map((img: string) => ({ type: 'image_url', image_url: { url: img } }))
        ]
      : message;

    // Keep only last 10 turns of raw transcript — accContext + summary already
    // carry long-term memory, and a shorter prompt is faster + cheaper.
    const messagesWithHistory = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-10).map(msg => {
        if (msg.role === 'assistant') {
          try {
            const parsed = JSON.parse(msg.content);
            if (parsed.results) {
              return {
                role: 'assistant',
                content: JSON.stringify({
                  blocks: parsed.blocks || [],
                  _system_note: "[Results omitted to save tokens. They are stored in DB.]"
                })
              };
            }
          } catch (e) {
            // Ignored
          }
        }
        return { role: msg.role, content: msg.content };
      }),
      { role: 'user', content: userMessageContent }
    ];

    const t0 = Date.now();
    console.log(`[AI] Calling OpenAI (gpt-4o-mini, history=${Math.min(chatHistory.length, 10)} turns)`);

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messagesWithHistory,
        max_tokens: 1500,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[AI] OpenAI error:', aiResponse.status, errorText);

      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
        );
      }

      throw new Error(`AI service error: ${aiResponse.status}`);
    }
    console.log(`[AI] OpenAI responded in ${Date.now() - t0}ms`);

    const aiData = await aiResponse.json();
    let responseContent = aiData.choices[0].message.content || '';
    
    console.log('[AI] Raw response length:', responseContent.length);
    
    // Normalize response (remove markdown code fences)
    responseContent = normalizeAiResponse(responseContent);
    
    // Try to extract JSON from the response if it contains JSON-like content
    let extractedJson: any = null;

    // First try direct parse
    try {
      extractedJson = JSON.parse(responseContent);
    } catch {
      // Try to find JSON within the text — match either a results-bearing or blocks-bearing object
      const jsonMatch =
        responseContent.match(/\{[\s\S]*"results"\s*:\s*\[[\s\S]*\][\s\S]*\}/) ||
        responseContent.match(/\{[\s\S]*"blocks"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
      if (jsonMatch) {
        try {
          extractedJson = JSON.parse(jsonMatch[0]);
          console.log('[AI] Extracted JSON from mixed content');
        } catch {
          console.log('[AI] Failed to extract JSON from mixed content');
        }
      }
    }

    // Sanitize blocks (best-effort): keep only known types and required fields.
    function sanitizeBlocks(raw: any): any[] | undefined {
      if (!Array.isArray(raw)) return undefined;
      const allowed = new Set(['text', 'complex', 'district', 'distance', 'followups']);
      const clipStr = (s: any, n = 600) => (typeof s === 'string' ? s.slice(0, n) : undefined);
      
      const extractedFollowups: string[] = [];

      const clean = raw
        .filter((b: any) => b && typeof b === 'object' && allowed.has(b.type))
        .map((b: any) => {
          if (b.type === 'text') {
            let body = clipStr(b.body, 1200) || '';
            const followupRegex = /^\s*-?\s*(\[(?:Ask|Search)\][^\r\n]+)/gim;
            let match;
            while ((match = followupRegex.exec(body)) !== null) {
              extractedFollowups.push(match[1].trim());
            }
            body = body.replace(/^\s*-?\s*\[(?:Ask|Search)\][^\n]*\n?/gim, '');
            body = body.replace(/^[^\w\n]*(?:Here are some|Some|These are some)?\s*(?:follow-?ups?|suggestions?)\s*(?:for you|to explore|to consider)?[:\s]*\n?/gim, '');
            body = body.replace(/^If you have specific interests or activities in mind, feel free to ask![^\n]*\n?/gim, '');
            body = body.replace(/\*\*/g, '');
            return { type: 'text', body: body.trim() };
          }
          if (b.type === 'followups') {
            const s = Array.isArray(b.suggestions) ? b.suggestions.filter((x: any) => typeof x === 'string').slice(0, 4).map((x: string) => x.slice(0, 120)) : [];
            extractedFollowups.push(...s);
            return null; // Will consolidate at the end
          }
          if (b.type === 'complex') {
            return {
              type: 'complex',
              name: clipStr(b.name, 120) || '',
              city: clipStr(b.city, 60),
              district: clipStr(b.district, 60),
              developer: clipStr(b.developer, 120),
              management: clipStr(b.management, 120),
              yearCompleted: typeof b.yearCompleted === 'number' ? b.yearCompleted : undefined,
              petPolicy: clipStr(b.petPolicy, 200),
              amenities: Array.isArray(b.amenities) ? b.amenities.filter((x: any) => typeof x === 'string').slice(0, 12).map((x: string) => x.slice(0, 60)) : undefined,
              rentRanges: Array.isArray(b.rentRanges) ? b.rentRanges.slice(0, 6).filter((r: any) => r && typeof r === 'object').map((r: any) => ({
                bedrooms: clipStr(r.bedrooms, 20) || '',
                minUsd: Number(r.minUsd) || 0,
                maxUsd: Number(r.maxUsd) || 0,
              })) : undefined,
              insiderNotes: clipStr(b.insiderNotes, 600),
              commute: Array.isArray(b.commute) ? b.commute.slice(0, 6).filter((c: any) => c && typeof c === 'object').map((c: any) => ({
                to: clipStr(c.to, 80) || '',
                minutes: Number(c.minutes) || 0,
              })) : undefined,
            };
          }
          if (b.type === 'district') {
            return {
              type: 'district',
              city: clipStr(b.city, 60),
              district: clipStr(b.district, 80) || '',
              vibe: clipStr(b.vibe, 400) || '',
              bestFor: Array.isArray(b.bestFor) ? b.bestFor.filter((x: any) => typeof x === 'string').slice(0, 6).map((x: string) => x.slice(0, 80)) : undefined,
              tradeoffs: Array.isArray(b.tradeoffs) ? b.tradeoffs.filter((x: any) => typeof x === 'string').slice(0, 6).map((x: string) => x.slice(0, 80)) : undefined,
              notableComplexes: Array.isArray(b.notableComplexes) ? b.notableComplexes.filter((x: any) => typeof x === 'string').slice(0, 8).map((x: string) => x.slice(0, 80)) : undefined,
            };
          }
          if (b.type === 'distance') {
            return {
              type: 'distance',
              from: clipStr(b.from, 60) || '',
              to: clipStr(b.to, 60) || '',
              km: typeof b.km === 'number' ? b.km : undefined,
              driveMinutes: typeof b.driveMinutes === 'number' ? b.driveMinutes : undefined,
              bikeMinutes: typeof b.bikeMinutes === 'number' ? b.bikeMinutes : undefined,
              notes: clipStr(b.notes, 200),
            };
          }
          return null;
        })
        .filter(Boolean) as any[];
        
      const finalClean = clean.filter((b: any) => b.type !== 'text' || b.body.length > 0);
      
      if (extractedFollowups.length > 0) {
        // Remove duplicates just in case
        const uniqueFollowups = Array.from(new Set(extractedFollowups)).slice(0, 4);
        finalClean.push({ type: 'followups', suggestions: uniqueFollowups });
      }

      return finalClean.length ? finalClean : undefined;
    }
    
    let sanitizedBlocks: any[] | undefined = undefined;
    if (extractedJson) {
      const rawBlocks = Array.isArray(extractedJson.blocks) ? extractedJson.blocks : [];
      // Handle case where AI outputs top-level followups instead of nesting inside blocks
      if (Array.isArray(extractedJson.followups) && extractedJson.followups.length > 0) {
        rawBlocks.push({ type: 'followups', suggestions: extractedJson.followups });
      }
      if (rawBlocks.length > 0) {
        sanitizedBlocks = sanitizeBlocks(rawBlocks);
      }
    }

    // ── GUARD: ensure lifestyle / blocks-only responses always contain a text
    //    block.  If sanitization stripped every text block (e.g. the model
    //    inlined [Ask]/[Search] into the text body), recover the answer from
    //    the original raw text body stored in the first text block before
    //    sanitization.
    if (sanitizedBlocks && sanitizedBlocks.length > 0) {
      const hasContentBlock = sanitizedBlocks.some(
        (b: any) => b.type === 'text' || b.type === 'complex' || b.type === 'district' || b.type === 'distance'
      );
      if (!hasContentBlock && extractedJson?.blocks) {
        // Find the first text block from the ORIGINAL (pre-sanitized) blocks
        const origTextBlock = extractedJson.blocks.find(
          (b: any) => b.type === 'text' && typeof b.body === 'string' && b.body.trim().length > 0
        );
        if (origTextBlock) {
          // Strip only bold markers, keep the rest
          let recoveredBody = origTextBlock.body.replace(/\*\*/g, '').trim();
          // Remove only standalone [Ask]/[Search] lines but keep surrounding text
          recoveredBody = recoveredBody.replace(/^\s*-?\s*\[(?:Ask|Search)\][^\n]*\n?/gim, '').trim();
          if (recoveredBody.length > 0) {
            console.log('[Sanitize] Recovered text block that was stripped empty by followup regex');
            sanitizedBlocks.unshift({ type: 'text', body: recoveredBody });
          }
        }
      }
    }

    // Ensure there is always a followups block
    if (!sanitizedBlocks) sanitizedBlocks = [];
    const hasFollowups = sanitizedBlocks.some(b => b.type === 'followups');
    if (!hasFollowups) {
      sanitizedBlocks.push({
        type: 'followups',
        suggestions: ['[Ask] Tell me more about this area', '[Search] Show me similar properties']
      });
    }

    // ========== POST-PROCESSING VALIDATION ==========
    let searchData: any = null;
    let usedFallback = false;

    if (extractedJson && Array.isArray(extractedJson.results) && extractedJson.results.length > 0) {
      console.log(`[Validation] AI returned ${extractedJson.results.length} results, validating...`);
      const validatedResults = validateAndFixAIResults(extractedJson.results, scoredProperties, accContext);
      console.log(`[Validation] ${validatedResults.length} results passed validation`);
      extractedJson.results = validatedResults;
      extractedJson.totalMatches = validatedResults.length;
      if (sanitizedBlocks) extractedJson.blocks = sanitizedBlocks;

      if (validatedResults.length === 0 && topProperties.length > 0 && !isPureLifestyle) {
        console.log('[Validation] All AI results rejected, using fallback from pre-scored properties');
        usedFallback = true;
      } else {
        searchData = extractedJson;
        responseContent = JSON.stringify(extractedJson);
      }
    } else if (extractedJson) {
      // Info-only response — no listings, just blocks.
      console.log(`[AI] Info-only response with ${sanitizedBlocks?.length || 0} blocks`);
      const fallbackSummary = extractedJson.summary || extractedJson.text || extractedJson.message || extractedJson.content || extractedJson.answer || '';
      
      const infoOnly = { 
        results: [], 
        summary: fallbackSummary, 
        totalMatches: 0, 
        blocks: sanitizedBlocks || []
      };
      
      // If we still have no readable text to show the user, fall back to a polite error message
      if (!infoOnly.summary && !infoOnly.blocks.some((b: any) => b.type === 'text' || b.type === 'district' || b.type === 'complex' || b.type === 'distance')) {
         let fallbackBody = "I'm sorry, I couldn't find a detailed description for that. Please try one of the suggested options below.";
         
         // Try to extract any long string values from the json, ignoring arrays
         const stringValues = Object.values(extractedJson).filter(v => typeof v === 'string' && v.length > 20);
         if (stringValues.length > 0) {
            fallbackBody = stringValues.join('\n\n');
         }
         infoOnly.blocks.unshift({ type: 'text', body: fallbackBody });
      }

      searchData = infoOnly;
      responseContent = JSON.stringify(infoOnly);
    }

    
    // FALLBACK: If AI didn't return valid JSON or all results were rejected, use pre-scored properties
    if (!searchData && topProperties.length > 0 && !isPureLifestyle) {
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
        amenities: p.amenities,
        vibe_analysis: p.vibe_analysis || null,
        rooms: p.rooms || null,
        property_source_link: p.property_source_link || null,
        sourceProviderName: p.providerName || null,
        sourceProviderPhone: p.providerPhone || null,
        matchScore: p.matchScore,
        matchReason: p.matchReasons.length > 0 
          ? p.matchReasons.join(', ') 
          : `Great ${p.styles[0] || 'modern'} apartment in ${p.location.split(',')[0]} at ${(p.price/1000000).toFixed(1)}M VND/month`,
        realtor_id: p.realtor_id,
        isExternal: !!p.isExternal,
        source: p.source || null,
        sourceUrl: p.sourceUrl || null
      }));
      
      // Generate a summary based on context
      let summary = '';
      if (imageAnalysisResult) {
        summary += `I detected a ${imageAnalysisResult.styles.join(', ')} style with ${imageAnalysisResult.colors.join(', ')} tones from your image. `;
      }
      summary += `Here are ${fallbackResults.length} matching apartments`;
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
      
      const aiSummary = extractedJson?.summary || extractedJson?.text || extractedJson?.message || extractedJson?.content || extractedJson?.answer || '';
      const finalSummary = aiSummary ? `${aiSummary}\n\n${summary}` : summary;
      
      searchData = {
        results: fallbackResults,
        summary: finalSummary,
        totalMatches: fallbackResults.length,
        blocks: sanitizedBlocks || []
      };
      responseContent = JSON.stringify(searchData);
      console.log(`[Fallback] Generated ${fallbackResults.length} property results`);
    }
    
    // If still no search data and no properties, keep the AI's conversational response
    // BUT first check if plain-text response contains embedded followups we can extract
    if (!searchData) {
      console.log('[Response] No properties to show, checking plain text for embedded followups');
      const plainText = responseContent;
      const followupExtract: string[] = [];
      const fupRe = /^\s*-?\s*(\[(?:Ask|Search)\][^\r\n]+)/gim;
      let fupMatch;
      while ((fupMatch = fupRe.exec(plainText)) !== null) {
        followupExtract.push(fupMatch[1].trim());
      }
      if (followupExtract.length > 0) {
        // Strip the followup lines and their header from the text body
        let cleanBody = plainText;
        cleanBody = cleanBody.replace(/^\s*-?\s*\[(?:Ask|Search)\][^\n]*\n?/gim, '');
        cleanBody = cleanBody.replace(/^[^\w\n]*(?:Here are some|Some|These are some)?\s*(?:follow-?ups?|options?|questions?|suggestions?)[^\n]*:?\s*\n?/gim, '');
        cleanBody = cleanBody.replace(/^#+\s*(?:follow-?ups?|suggestions?)[^\n]*\n?/gim, '');
        cleanBody = cleanBody.replace(/\*\*/g, '');
        cleanBody = cleanBody.replace(/^If you have specific (?:needs|interests)[^\n]*\n?/gim, '');
        cleanBody = cleanBody.trim();

        const blocks: any[] = [];
        if (cleanBody.length > 0) {
          blocks.push({ type: 'text', body: cleanBody });
        }
        const uniqueFollowups = Array.from(new Set(followupExtract)).slice(0, 4);
        blocks.push({ type: 'followups', suggestions: uniqueFollowups });

        searchData = { results: [], summary: '', totalMatches: 0, blocks };
        responseContent = JSON.stringify(searchData);
        console.log(`[Response] Extracted ${uniqueFollowups.length} followups from plain text, converted to blocks`);
      } else {
        // Still plain text with no followups — strip markdown bold markers
        responseContent = responseContent.replace(/\*\*/g, '');
        console.log('[Response] Pure conversational response, no followups found');
      }
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
