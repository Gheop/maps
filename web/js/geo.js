import { setView, addMarker } from './map.js';

export function initGeo(button) {
  if (!('geolocation' in navigator)) { button.disabled = true; return; }
  let marker = null;
  button.addEventListener('click', () => {
    button.classList.add('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        button.classList.remove('loading');
        const { latitude, longitude } = pos.coords;
        if (marker) marker.remove();
        marker = addMarker(latitude, longitude);
        setView(latitude, longitude, 14);
      },
      () => { button.classList.remove('loading'); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}
