
# Add Popular Ward Descriptions to Map Modal

## Overview
Add ward-level descriptions for 50-100 popular and expat-friendly wards across Ho Chi Minh City, Hanoi, and Da Nang. These will appear in the map modal header, below the location title and above the map, just like district descriptions do today.

## Wards to Add

### Ho Chi Minh City (~40 wards)

**District 1**: Ben Nghe, Ben Thanh, Da Kao, Nguyen Thai Binh, Pham Ngu Lao, Tan Dinh, Co Giang
**District 2 / Thu Duc**: Thao Dien (already exists), An Phu (already exists), Thanh My Loi, An Khanh, Binh An, Cat Lai
**District 3**: Vo Thi Sau, Ward 1-14 highlights (key ones)
**District 4**: Ben Van Don area wards
**District 7**: Phu My Hung, Tan Phong, Tan Phu (D7)
**Binh Thanh**: Ward 1, Ward 2, Hang Xanh area
**Phu Nhuan**: Ward 1-17 key areas
**Tan Binh**: Ward 1-15, near airport wards
**Go Vap**: Key wards near Pham Van Dong

### Hanoi (~30 wards)

**Hoan Kiem**: Hang Bai, Hang Bong, Hang Gai, Phan Chu Trinh, Trang Tien
**Tay Ho**: Quang An, Xuan La, Nhat Tan, Tu Lien
**Ba Dinh**: Lieu Giai, Kim Ma, Ngoc Ha, Truc Bach
**Cau Giay**: Dich Vong, Dich Vong Hau, Nghia Do, Nghia Tan
**Dong Da**: Cat Linh, Kham Thien, O Cho Dua
**Hai Ba Trung**: Bach Khoa, Thanh Nhan, Dong Nhan
**Long Bien**: Ngoc Thuy, Phuc Dong, Viet Hung

### Da Nang (~15 wards)

**Hai Chau**: Hai Chau 1, Hai Chau 2, Thanh Binh, Thuan Phuoc
**Son Tra**: An Hai Bac, An Hai Dong, Man Thai, Phuoc My (My Khe Beach)
**Ngu Hanh Son**: My An, Khue My, Hoa Hai

## Technical Details

### Changes to `src/components/MapViewModal.tsx`

- Expand the `DISTRICT_DESCRIPTIONS` dictionary with ~80 new ward entries (both accented and unaccented Vietnamese forms for each)
- The existing `getLocationDescription()` function already performs substring matching, so ward names within full addresses like "An Phu Ward, District 2, Ho Chi Minh City" will automatically match
- Ward entries will be placed before district entries in the object so more specific matches are found first (e.g., "An Phu" matches before the broader "District 2")

### Matching Priority
The `getLocationDescription` function iterates through keys in insertion order. By placing ward-level keys before district-level keys, a location like "Thanh My Loi Ward, District 2" will match the ward description first rather than the generic District 2 description.

### Example entries
```
'ben nghe': 'Heart of District 1 with Nguyen Hue walking street, luxury hotels, and Saigon River promenade',
'bến nghé': 'Heart of District 1 with Nguyen Hue walking street, luxury hotels, and Saigon River promenade',
'da kao': 'Charming neighborhood near the zoo with French-era villas, quiet cafes, and tree-lined avenues',
'đa kao': 'Charming neighborhood near the zoo with French-era villas, quiet cafes, and tree-lined avenues',
```

### No other files need changes
The geocoding utilities and edge functions remain unchanged since this is purely a UI description feature within the map modal.
