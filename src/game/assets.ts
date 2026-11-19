import { EnemyKind } from './types';

export interface SpriteEntry {
  img: HTMLImageElement;
  flash: HTMLCanvasElement;
}

export class AssetAtlas {
  public ready = false;
  public hero: SpriteEntry | null = null;
  public enemies: Partial<Record<EnemyKind, SpriteEntry>> = {};
  public rift: HTMLImageElement | null = null;
  public barricade: HTMLImageElement | null = null;

  public texStoneFloor: HTMLImageElement | null = null;
  public texWallMasonry: HTMLImageElement | null = null;
  public texMoltenLava: HTMLImageElement | null = null;

  public onLoaded?: () => void;

  public loadAll(): void {
    if (typeof Image === 'undefined') return;

    const loadImg = (src: string): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });

    const base = './assets';

    const jobs: Array<Promise<void>> = [
      loadImg(`${base}/hero_warmage.png`).then((img) => {
        if (img) this.hero = { img, flash: this.makeWhiteSilhouette(img) };
      }),
      loadImg(`${base}/ork_grunt.png`).then((img) => {
        if (img) this.enemies.grunt = { img, flash: this.makeWhiteSilhouette(img) };
      }),
      loadImg(`${base}/ork_kobold.png`).then((img) => {
        if (img) this.enemies.kobold = { img, flash: this.makeWhiteSilhouette(img) };
      }),
      loadImg(`${base}/ork_sapper.png`).then((img) => {
        if (img) this.enemies.sapper = { img, flash: this.makeWhiteSilhouette(img) };
      }),
      loadImg(`${base}/ork_brute.png`).then((img) => {
        if (img) this.enemies.brute = { img, flash: this.makeWhiteSilhouette(img) };
      }),
      loadImg(`${base}/ork_ogre.png`).then((img) => {
        if (img) this.enemies.ogre = { img, flash: this.makeWhiteSilhouette(img) };
      }),
      loadImg(`${base}/prop_rift.png`).then((img) => {
        this.rift = img;
      }),
      loadImg(`${base}/prop_barricade.png`).then((img) => {
        this.barricade = img;
      }),
      loadImg(`${base}/tex_stone_dungeon.jpg`).then((img) => {
        this.texStoneFloor = img;
      }),
      loadImg(`${base}/tex_wall_masonry.jpg`).then((img) => {
        this.texWallMasonry = img;
      }),
      loadImg(`${base}/tex_molten_lava.jpg`).then((img) => {
        this.texMoltenLava = img;
      }),
    ];

    void Promise.all(jobs).then(() => {
      this.ready = true;
      if (this.onLoaded) this.onLoaded();
    });
  }

  /**
   * Pre-bakes a crisp pure-white silhouette canvas for zero-cost impact hit-flashes.
   */
  private makeWhiteSilhouette(img: HTMLImageElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d');
    if (g) {
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }
}
