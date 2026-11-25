/** 合成 HTML，仅用于离线解析测试，不是线上商品页快照。 */

const GOODS = 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001'

export const FIXTURE_FULL = `<!doctype html>
<html>
  <head><link rel="canonical" href="${GOODS}"></head>
  <body>
    <section data-competitor-region="hero" data-hero-total="3" class="swiper-container">
      <div class="swiper-wrapper">
        <div class="swiper-slide"><img src="https://img.example.test/hero-1.jpg" alt="主图1"></div>
        <div class="swiper-slide"><img src="https://img.example.test/hero-2.jpg" alt="主图2"></div>
        <div class="swiper-slide"><img src="https://img.example.test/hero-2.jpg" alt="重复节点"></div>
        <div class="swiper-slide"><img src="https://img.example.test/hero-3.jpg" alt="主图3"></div>
      </div>
      <div>1 / 3</div>
    </section>
    <section data-competitor-region="detail" class="goods-detail">
      <h3>商品详情</h3>
      <img src="https://img.example.test/detail-1.jpg" width="800" height="1000" alt="详情1">
      <img src="https://img.example.test/detail-long.jpg" width="800" height="4000" alt="长图">
    </section>
    <div data-competitor-region="option-panel" role="dialog">
      <div>选购</div>
      <div data-competitor-option>
        <img data-competitor-image="option" src="https://img.example.test/opt-a.jpg">
        <span data-competitor-option-name>单独一只挖掘机</span>
        <span>¥19.9</span>
        <span>预计送达明天</span>
        <button>立即购买</button>
      </div>
      <div data-competitor-option>
        <img data-competitor-image="option" src="https://img.example.test/opt-b.jpg">
        <span data-competitor-option-name>加10个仿真塑料石头+2人仔</span>
        <span>¥29.9</span>
      </div>
      <div data-competitor-option>
        <img data-competitor-image="option" src="https://img.example.test/opt-c.jpg">
        <span data-competitor-option-name>加10个仿真塑料石头+2人仔+6只迷你工程车</span>
        <span>¥39.9</span>
      </div>
    </div>
  </body>
</html>`

export const FIXTURE_LAZY_AND_LONG = `<!doctype html>
<html>
  <body>
    <section class="swiper-container goods-top" data-competitor-region="hero" data-hero-total="4">
      <img src="https://img.example.test/hero-1.jpg">
      <img src="https://img.example.test/hero-1.jpg" alt="重复">
      <img data-src="https://img.example.test/hero-2.jpg" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <img alt="尚未出现的第3张">
      <div>1 / 4</div>
    </section>
    <section class="goods-detail">
      <h3>商品详情</h3>
      <img data-src="https://img.example.test/detail-long.jpg" data-width="750" data-height="4500">
    </section>
  </body>
</html>`

export const FIXTURE_CLOSED_OPTIONS = `<!doctype html>
<html>
  <body>
    <section data-competitor-region="hero" data-hero-total="1">
      <img src="https://img.example.test/hero-1.jpg">
    </section>
    <section data-competitor-region="detail">
      <img src="https://img.example.test/detail-1.jpg" width="800" height="900">
    </section>
    <div data-competitor-region="option-panel" hidden>
      <div data-competitor-option>
        <img src="https://img.example.test/opt-a.jpg">
        <span data-competitor-option-name>单独一只挖掘机</span>
      </div>
    </div>
  </body>
</html>`

export const FIXTURE_MISSING_OPTION_IMAGE = `<!doctype html>
<html>
  <body>
    <section data-competitor-region="hero"><img src="https://img.example.test/hero-1.jpg"></section>
    <div data-competitor-region="option-panel">
      <div>选购</div>
      <div data-competitor-option>
        <img src="https://img.example.test/opt-a.jpg">
        <span data-competitor-option-name>单独一只挖掘机</span>
      </div>
      <div data-competitor-option>
        <span data-competitor-option-name>加10个仿真塑料石头+2人仔</span>
        <span>¥29.9</span>
      </div>
    </div>
  </body>
</html>`

export const FIXTURE_HERO_AS_OPTION = `<!doctype html>
<html>
  <body>
    <section data-competitor-region="hero">
      <img src="https://img.example.test/hero-1.jpg">
    </section>
    <div data-competitor-region="option-panel">
      <div data-competitor-option>
        <img src="https://img.example.test/hero-1.jpg">
        <span data-competitor-option-name>单独一只挖掘机</span>
      </div>
    </div>
  </body>
</html>`

export const FIXTURE_LOGIN_WALL = `<!doctype html>
<html>
  <body>
    <h1>请先登录</h1>
    <form>
      <input type="tel" placeholder="手机号">
      <input type="password" placeholder="密码">
      <button>登录</button>
    </form>
  </body>
</html>`


export const FIXTURE_SOLD_OUT_RECOMMEND = `<!doctype html>
<html>
  <body>
    <h1>商品已售罄</h1>
    <p>推荐以下相似商品</p>
    <section class="swiper-container recommend-gallery">
      <div class="swiper-slide"><img src="https://img.example.test/rec-clothes.jpg" alt="衣服"></div>
      <div class="swiper-slide"><img src="https://img.example.test/rec-phone-case.jpg" alt="手机壳"></div>
    </section>
  </body>
</html>`

export const FIXTURE_NORMAL_WITH_FOOTER_RECOMMEND = `<!doctype html>
<html>
  <head><link rel="canonical" href="${GOODS}"></head>
  <body>
    <section data-competitor-region="hero" data-hero-total="1" class="swiper-container">
      <div class="swiper-wrapper">
        <div class="swiper-slide"><img src="https://img.example.test/hero-1.jpg" alt="主图1"></div>
      </div>
    </section>
    <section data-competitor-region="detail" class="goods-detail">
      <h3>商品详情</h3>
      <img src="https://img.example.test/detail-1.jpg" width="800" height="1000" alt="详情1">
    </section>
    <aside>
      <h3>店铺推荐</h3>
      <img src="https://img.example.test/rec-other.jpg" alt="其他推荐">
    </aside>
  </body>
</html>`

export const FIXTURE_SKU_SOLD_AND_FOOTER_RECOMMEND = `<!doctype html>
<html>
  <head><link rel="canonical" href="${GOODS}"></head>
  <body>
    <section data-competitor-region="hero" data-hero-total="1" class="swiper-container">
      <div class="swiper-wrapper">
        <div class="swiper-slide"><img src="https://img.example.test/hero-1.jpg" alt="主图1"></div>
      </div>
    </section>
    <section data-competitor-region="detail" class="goods-detail">
      <h1>示例商品</h1>
      <p>其中一款规格商品已售罄</p>
      <img src="https://img.example.test/detail-1.jpg" width="800" height="1000" alt="详情1">
    </section>
    <footer>
      <p>推荐以下相似商品</p>
      <img src="https://img.example.test/rec-other.jpg" alt="其他推荐">
    </footer>
  </body>
</html>`

export const FIXTURE_HIDDEN_SOLD_OUT_TEXT = `<!doctype html>
<html>
  <head><link rel="canonical" href="${GOODS}"></head>
  <body>
    <div hidden>商品已售罄。推荐以下相似商品</div>
    <section data-competitor-region="hero" data-hero-total="1" class="swiper-container">
      <div class="swiper-wrapper">
        <div class="swiper-slide"><img src="https://img.example.test/hero-1.jpg" alt="主图1"></div>
      </div>
    </section>
    <section data-competitor-region="detail" class="goods-detail">
      <h3>商品详情</h3>
      <img src="https://img.example.test/detail-1.jpg" width="800" height="1000" alt="详情1">
    </section>
  </body>
</html>`

export const FIXTURE_DELISTED_MAIN = `<!doctype html>
<html>
  <body>
    <main>
      <h1>该商品已下架</h1>
      <p>暂时无法购买</p>
    </main>
    <aside>
      <p>推荐以下相似商品</p>
      <img src="https://img.example.test/rec-other.jpg" alt="其他推荐">
    </aside>
  </body>
</html>`


const EIGHT_HERO_SLIDES = Array.from({ length: 8 }, (_, index) => {
  const n = index + 1
  return `<div class="swiper-slide"><img src="https://img.example.test/hero-${n}.jpg" alt="主图${n}"></div>`
}).join('')

const EIGHTEEN_DETAIL_IMGS = [
  ...Array.from({ length: 17 }, (_, index) => `<img src="https://img.example.test/detail-${index + 1}.jpg" width="800" height="1000" alt="详情${index + 1}">`),
  '<img src="https://img.example.test/hero-1.jpg" width="800" height="1000" alt="与主图重复的详情">',
].join('\n      ')

export const FIXTURE_EIGHT_HERO_SHARED_OPTIONS = `<!doctype html>
<html>
  <head><link rel="canonical" href="${GOODS}"></head>
  <body>
    <h1>超大号黄色挖掘机【加破拆头】</h1>
    <section data-competitor-region="hero" data-hero-total="8" class="swiper-container">
      <div class="swiper-wrapper">
        ${EIGHT_HERO_SLIDES}
      </div>
      <div>1 / 8</div>
    </section>
    <section data-competitor-region="detail" class="goods-detail">
      <h3>商品详情</h3>
      ${EIGHTEEN_DETAIL_IMGS}
    </section>
    <div data-competitor-region="option-panel" role="dialog">
      <div>选购</div>
      <div data-competitor-option>
        <img data-competitor-image="option" src="https://img.example.test/opt-share-a.jpg">
        <span data-competitor-option-name>单独一只挖掘机</span>
      </div>
      <div data-competitor-option>
        <img data-competitor-image="option" src="https://img.example.test/opt-share-a.jpg">
        <span data-competitor-option-name>【加10个仿真塑料石头+2人仔】</span>
      </div>
      <div data-competitor-option>
        <img data-competitor-image="option" src="https://img.example.test/opt-share-b.jpg">
        <span data-competitor-option-name>【加10个仿真塑料石头+2人仔+6只迷你工程车】</span>
      </div>
    </div>
    <footer>
      <p>推荐以下相似商品</p>
      <img src="https://img.example.test/rec-other.jpg" alt="其他推荐">
    </footer>
  </body>
</html>`

export const FIXTURE_POST_LOGIN_HOME = `<!doctype html>
<html>
  <body>
    <header>拼多多首页</header>
    <section>
      <p>推荐以下相似商品</p>
      <img src="https://img.example.test/rec-home.jpg" alt="首页推荐">
    </section>
    <p>商品已售罄</p>
  </body>
</html>`

export const SHARE_HREF = 'https://mobile.yangkeduo.com/goods2.html?ps=fixture-not-a-secret'
export const OTHER_GOODS = 'https://mobile.yangkeduo.com/goods2.html?goods_id=1022650930715'

export const FIXTURE_SHARE_OG_IDENTITY = `<!doctype html>
<html>
  <head>
    <meta property="og:url" content="${GOODS}">
  </head>
  <body>
    <section data-competitor-region="hero" data-hero-total="1" class="swiper-container">
      <div class="swiper-wrapper">
        <div class="swiper-slide"><img src="https://img.example.test/hero-1.jpg" alt="主图1"></div>
      </div>
    </section>
    <section data-competitor-region="detail" class="goods-detail">
      <h3>商品详情</h3>
      <img src="https://img.example.test/detail-1.jpg" width="800" height="1000" alt="详情1">
    </section>
  </body>
</html>`

export const FIXTURE_SHARE_DOM_IDENTITY = `<!doctype html>
<html>
  <body>
    <section data-competitor-region="hero" data-hero-total="1" class="swiper-container" data-goods-id="100000000001">
      <div class="swiper-wrapper">
        <div class="swiper-slide"><img src="https://img.example.test/hero-1.jpg" alt="主图1"></div>
      </div>
    </section>
    <section data-competitor-region="detail" class="goods-detail">
      <h3>商品详情</h3>
      <img src="https://img.example.test/detail-1.jpg" width="800" height="1000" alt="详情1">
    </section>
  </body>
</html>`

export const FIXTURE_SHARE_RECOMMEND_ONLY_ID = `<!doctype html>
<html>
  <body>
    <section data-competitor-region="hero" data-hero-total="1" class="swiper-container">
      <div class="swiper-wrapper">
        <div class="swiper-slide"><img src="https://img.example.test/hero-1.jpg" alt="主图1"></div>
      </div>
    </section>
    <section data-competitor-region="detail" class="goods-detail">
      <h3>商品详情</h3>
      <img src="https://img.example.test/detail-1.jpg" width="800" height="1000" alt="详情1">
    </section>
    <aside data-goods-id="1022650930715">
      <h3>店铺推荐</h3>
      <img src="https://img.example.test/rec-other.jpg" alt="其他推荐">
    </aside>
  </body>
</html>`

export const FIXTURE_SHARE_WRONG_OG = `<!doctype html>
<html>
  <head>
    <meta property="og:url" content="${OTHER_GOODS}">
  </head>
  <body>
    <section data-competitor-region="hero" data-hero-total="1" class="swiper-container">
      <div class="swiper-wrapper">
        <div class="swiper-slide"><img src="https://img.example.test/hero-1.jpg" alt="主图1"></div>
      </div>
    </section>
    <section data-competitor-region="detail" class="goods-detail">
      <h3>商品详情</h3>
      <img src="https://img.example.test/detail-1.jpg" width="800" height="1000" alt="详情1">
    </section>
  </body>
</html>`
