// Kulturer med EPPO-koder (kontrollert mot gd.eppo.int, se v1). Navn oversettes via i18n-nøkler.
import { t } from '../i18n.js';
export const CROPS = [
  { eppo: 'FRAAN', key: 'crop.strawberry', latin: 'Fragaria x ananassa' },
  { eppo: 'RUBID', key: 'crop.raspberry', latin: 'Rubus idaeus' },
  { eppo: 'VACCO', key: 'crop.blueberry', latin: 'Vaccinium corymbosum' },
  { eppo: 'RIBNI', key: 'crop.blackcurrant', latin: 'Ribes nigrum' },
  { eppo: 'RIBRU', key: 'crop.redcurrant', latin: 'Ribes rubrum' },
  { eppo: 'RIBUC', key: 'crop.gooseberry', latin: 'Ribes uva-crispa' },
  { eppo: 'RUBFR', key: 'crop.blackberry', latin: 'Rubus fruticosus' },
  { eppo: 'PRNAV', key: 'crop.cherry', latin: 'Prunus avium' },
  { eppo: 'MABSD', key: 'crop.apple', latin: 'Malus domestica' },
];
export const cropName = (eppo) => { const c = CROPS.find((x) => x.eppo === eppo); return c ? t(c.key) : eppo || '–'; };
