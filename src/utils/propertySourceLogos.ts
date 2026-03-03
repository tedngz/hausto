export const getPropertySourceLogo = (sourceLink: string): { name: string; logo: string } => {
  const url = (sourceLink || '').toLowerCase();
  
  if (url.includes('airbnb')) {
    return {
      name: 'Airbnb',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/6/69/Airbnb_Logo_Bélo.svg'
    };
  }
  
  if (url.includes('zillow')) {
    return {
      name: 'Zillow',
      logo: 'https://s.zillowstatic.com/pfs/static/z-logo-default.svg'
    };
  }
  
  if (url.includes('realtor.com')) {
    return {
      name: 'Realtor.com',
      logo: 'https://www.realtor.com/images/icons/realtor-logo.png'
    };
  }
  
  if (url.includes('apartments.com')) {
    return {
      name: 'Apartments.com',
      logo: 'https://images.apartments.com/favicon.ico'
    };
  }
  
  if (url.includes('rent.com')) {
    return {
      name: 'Rent.com',
      logo: 'https://www.rent.com/favicon.ico'
    };
  }
  
  if (url.includes('batdongsan') || url === 'batdongsan') {
    return {
      name: 'Batdongsan.com.vn',
      logo: '/logos/batdongsan-logo.svg'
    };
  }
  
  if (url.includes('nhatot') || url === 'nhatot') {
    return {
      name: 'Nhà Tốt',
      logo: '/logos/nhatot-logo.png'
    };
  }
  
  // Default fallback
  return {
    name: 'External Source',
    logo: 'https://via.placeholder.com/24x24/6B7280/FFFFFF?text=EXT'
  };
};