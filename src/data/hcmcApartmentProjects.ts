/**
 * Curated catalog of well-known HCMC apartment projects/complexes.
 * Used by Admin → Project-Targeted Crawl to focus external listing crawls
 * on inventory renters actually search for.
 *
 * `district` matches the district label format the marketplace URL builders
 * understand (e.g. "D1", "Thu Duc", "Tan Phu", "Binh Thanh").
 * `aliases` cover Vietnamese / English variants so the keyword search
 * + post-filter both work.
 */
export interface ApartmentProject {
  name: string;
  district: string;
  city: 'ho_chi_minh' | 'hanoi' | 'da_nang';
  aliases?: string[];
}

export const HCMC_APARTMENT_PROJECTS: ApartmentProject[] = [
  // ── D1 / D4 (Central) ─────────────────────────────────────────────
  { name: 'Vinhomes Golden River', district: 'D1', city: 'ho_chi_minh', aliases: ['Ba Son', 'Vinhomes Ba Son'] },
  { name: 'Saigon Royal', district: 'D4', city: 'ho_chi_minh', aliases: ['Sài Gòn Royal'] },
  { name: 'The Tresor', district: 'D4', city: 'ho_chi_minh' },
  { name: 'The Marq', district: 'D1', city: 'ho_chi_minh' },
  { name: 'Sunwah Pearl', district: 'Binh Thanh', city: 'ho_chi_minh' },
  { name: 'Millennium', district: 'D4', city: 'ho_chi_minh', aliases: ['Millennium Masteri'] },
  { name: 'Icon 56', district: 'D4', city: 'ho_chi_minh' },
  { name: 'RiverGate Residence', district: 'D4', city: 'ho_chi_minh', aliases: ['Rivergate'] },
  { name: 'Charmington La Pointe', district: 'D10', city: 'ho_chi_minh' },

  // ── D2 / Thu Duc (East) — Thao Dien / An Phu ──────────────────────
  { name: 'Masteri Thao Dien', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Masteri Thảo Điền'] },
  { name: 'Masteri An Phu', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Masteri An Phú'] },
  { name: 'Gateway Thao Dien', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Gateway Thảo Điền'] },
  { name: 'Estella Heights', district: 'Thu Duc', city: 'ho_chi_minh' },
  { name: 'The Estella', district: 'Thu Duc', city: 'ho_chi_minh' },
  { name: 'The Vista', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['The Vista An Phu', 'The Vista An Phú'] },
  { name: 'Thao Dien Pearl', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Thảo Điền Pearl'] },
  { name: 'Q2 Thao Dien', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Q2 Thảo Điền'] },
  { name: 'Lumiere Riverside', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Lumière Riverside'] },
  { name: "D'Edge Thao Dien", district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['DEdge', 'D Edge Thảo Điền'] },
  { name: 'Nassim Thao Dien', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Nassim Thảo Điền'] },

  // ── D2 / Thu Duc — Thu Thiem / An Khanh ───────────────────────────
  { name: 'Empire City', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Empire City Thu Thiem', 'Empire City Thủ Thiêm'] },
  { name: 'The River Thu Thiem', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['The River Thủ Thiêm'] },
  { name: 'Sala Thu Thiem', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Sala', 'Sarimi', 'Sarina', 'Sadora', 'Đại Quang Minh'] },
  { name: 'New City Thu Thiem', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['New City', 'Thủ Thiêm New City', 'New City Thủ Thiêm'] },
  { name: 'Diamond Island', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Đảo Kim Cương', 'Dao Kim Cuong'] },

  // ── D2 / Thu Duc — Cat Lai / An Phu south ─────────────────────────
  { name: 'The Sun Avenue', district: 'Thu Duc', city: 'ho_chi_minh' },
  { name: 'The Krista', district: 'Thu Duc', city: 'ho_chi_minh' },
  { name: 'The CBD Premium Home', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['CBD Premium'] },

  // ── Thu Duc north ─────────────────────────────────────────────────
  { name: 'Vinhomes Grand Park', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Vinhomes Q9', 'Origami', 'Glory Heights', 'S-series Vinhomes'] },
  { name: 'Lavita Charm', district: 'Thu Duc', city: 'ho_chi_minh' },
  { name: 'Lavita Garden', district: 'Thu Duc', city: 'ho_chi_minh' },
  { name: 'Centana Thu Thiem', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Centana Thủ Thiêm'] },

  // ── D7 (Phu My Hung) ──────────────────────────────────────────────
  { name: 'Sky Garden', district: 'D7', city: 'ho_chi_minh', aliases: ['Sky Garden 1', 'Sky Garden 2', 'Sky Garden 3', 'Sky Garden PMH'] },
  { name: 'Riverside Residence', district: 'D7', city: 'ho_chi_minh', aliases: ['Riverside PMH', 'Phu My Hung Riverside'] },
  { name: 'Happy Valley', district: 'D7', city: 'ho_chi_minh', aliases: ['Happy Valley PMH'] },
  { name: 'Midtown Phu My Hung', district: 'D7', city: 'ho_chi_minh', aliases: ['Midtown', 'Sakura Midtown', 'The Peak Midtown', 'The Signature Midtown'] },
  { name: 'Scenic Valley', district: 'D7', city: 'ho_chi_minh', aliases: ['Scenic Valley PMH'] },
  { name: 'The Panorama', district: 'D7', city: 'ho_chi_minh', aliases: ['Panorama Phu My Hung'] },
  { name: 'Saigon South Residences', district: 'D7', city: 'ho_chi_minh', aliases: ['SSR', 'Saigon South Phu My Hung'] },
  { name: 'The Ascentia', district: 'D7', city: 'ho_chi_minh' },
  { name: 'Urban Hill', district: 'D7', city: 'ho_chi_minh' },
  { name: 'Happy Residence', district: 'D7', city: 'ho_chi_minh', aliases: ['Hung Phuc', 'Hưng Phúc Happy Residence'] },
  { name: 'Riviera Point', district: 'D7', city: 'ho_chi_minh' },
  { name: 'Eco Green Saigon', district: 'D7', city: 'ho_chi_minh' },

  // ── Binh Thanh ────────────────────────────────────────────────────
  { name: 'Vinhomes Central Park', district: 'Binh Thanh', city: 'ho_chi_minh', aliases: ['Landmark 81', 'Vinhomes Tan Cang', 'Vinhomes Tân Cảng', 'Park 1', 'Park 2', 'Park 3', 'Central 1', 'Central 2', 'Central 3'] },
  { name: 'Saigon Pearl', district: 'Binh Thanh', city: 'ho_chi_minh', aliases: ['Sài Gòn Pearl', 'Ruby Saigon Pearl', 'Sapphire Saigon Pearl', 'Topaz Saigon Pearl'] },
  { name: 'City Garden', district: 'Binh Thanh', city: 'ho_chi_minh' },
  { name: 'The Manor', district: 'Binh Thanh', city: 'ho_chi_minh', aliases: ['The Manor Binh Thanh'] },
  { name: 'Pearl Plaza', district: 'Binh Thanh', city: 'ho_chi_minh' },

  // ── Phu Nhuan / Tan Binh ──────────────────────────────────────────
  { name: 'The Botanica', district: 'Tan Binh', city: 'ho_chi_minh', aliases: ['Botanica Premier', 'Botanica Pho Quang'] },
  { name: 'Garden Gate', district: 'Phu Nhuan', city: 'ho_chi_minh' },
  { name: 'Newton Residence', district: 'Phu Nhuan', city: 'ho_chi_minh' },
  { name: 'Orchard Parkview', district: 'Phu Nhuan', city: 'ho_chi_minh' },
  { name: 'Orchard Garden', district: 'Phu Nhuan', city: 'ho_chi_minh' },
  { name: 'Kingston Residence', district: 'Phu Nhuan', city: 'ho_chi_minh' },
  { name: 'Republic Plaza', district: 'Tan Binh', city: 'ho_chi_minh' },
  { name: 'Cong Hoa Garden', district: 'Tan Binh', city: 'ho_chi_minh', aliases: ['Cộng Hòa Garden'] },

  // ── Tan Phu ───────────────────────────────────────────────────────
  { name: 'Celadon City', district: 'Tan Phu', city: 'ho_chi_minh', aliases: ['Ruby Celadon', 'Emerald Celadon', 'Sapphire Celadon', 'Diamond Alnata', 'Diamond Alnata Plus'] },
  { name: 'Carillon', district: 'Tan Phu', city: 'ho_chi_minh', aliases: ['Carillon 1', 'Carillon 2', 'Carillon 5', 'Carillon 7'] },
  { name: 'Richstar', district: 'Tan Phu', city: 'ho_chi_minh', aliases: ['Richstar Novaland'] },
  { name: 'Jamila', district: 'Thu Duc', city: 'ho_chi_minh', aliases: ['Jamila Khang Dien'] },

  // ── D5 / D10 / D11 ────────────────────────────────────────────────
  { name: 'Hado Centrosa Garden', district: 'D10', city: 'ho_chi_minh', aliases: ['Hà Đô Centrosa', 'Centrosa Garden'] },
  { name: 'Rivera Park', district: 'D10', city: 'ho_chi_minh' },
  { name: 'Res 11', district: 'D11', city: 'ho_chi_minh' },
  { name: 'The Everrich Infinity', district: 'D5', city: 'ho_chi_minh', aliases: ['Everrich Infinity'] },

  // ── Go Vap / D12 ──────────────────────────────────────────────────
  { name: 'Botanica Pho Quang', district: 'Go Vap', city: 'ho_chi_minh', aliases: ['Botanica Phổ Quang'] },
  { name: 'Orchid Park', district: 'Go Vap', city: 'ho_chi_minh' },
  { name: 'Sunview Town', district: 'Thu Duc', city: 'ho_chi_minh' },
  { name: 'Dream Home Riverside', district: 'D12', city: 'ho_chi_minh' },
];

/** Group by district for the admin UI */
export function groupProjectsByDistrict(
  projects: ApartmentProject[] = HCMC_APARTMENT_PROJECTS
): Record<string, ApartmentProject[]> {
  return projects.reduce((acc, p) => {
    (acc[p.district] ||= []).push(p);
    return acc;
  }, {} as Record<string, ApartmentProject[]>);
}
