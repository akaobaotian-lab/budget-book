import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { yen } from '../lib/format';
import { SIDE_INCOME_THRESHOLD, TEMPORARY_INCOME_DEDUCTION, estimateTax } from '../lib/tax';

export function TaxPage({ month }: { month: string }) {
  const { data, updateSettings } = useStore();
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const s = data.settings.tax;
  const t = useMemo(() => estimateTax(data.transactions, year, s), [data.transactions, year, s]);
  const setTax = (patch: Partial<typeof s>) => updateSettings({ tax: { ...s, ...patch } });

  const progress = Math.min(100, (t.otherIncomeTotal / SIDE_INCOME_THRESHOLD) * 100);

  return (
    <div className="page">
      <div className="month-picker">
        <button type="button" className="icon-btn" onClick={() => setYear(year - 1)} aria-label="前の年">‹</button>
        <strong>{year}年の税金（年間の概算）</strong>
        <button type="button" className="icon-btn" onClick={() => setYear(year + 1)} aria-label="次の年">›</button>
      </div>

      <section className={`card hero ${t.taxOccurred ? (t.filingExempt ? 'warn-soft' : 'warn') : ''}`}>
        <span className="muted">副業・競馬によって発生する税金</span>
        <strong className="hero-num">{t.taxOccurred ? `約 ${yen(t.total)}` : '発生していません'}</strong>
        {t.taxOccurred && (
          <div className="stats">
            <div className="stat"><span className="stat-label">所得税（復興税込み）</span><strong>{yen(t.incomeTax)}</strong></div>
            <div className="stat"><span className="stat-label">住民税（10%）</span><strong>{yen(t.residentTax)}</strong></div>
          </div>
        )}
        {s.salaried && (
          <>
            <div className="bar threshold"><i style={{ width: `${progress}%` }} className={progress >= 100 ? 'over' : ''} /></div>
            <small>
              給与以外の所得 {yen(t.otherIncomeTotal)} ／ 申告ライン {yen(SIDE_INCOME_THRESHOLD)}
              {t.filingExempt ? `（あと${yen(t.remainingToThreshold)}で所得税が発生）` : '（超過：確定申告が必要）'}
            </small>
          </>
        )}
      </section>

      <section className="card">
        <h3>副業（雑所得）</h3>
        <table className="table">
          <tbody>
            <tr><td>副業の収入</td><td className="num">{yen(t.sideRevenue)}</td></tr>
            <tr><td>副業の経費</td><td className="num">-{yen(t.sideExpenses)}</td></tr>
            <tr className="total"><td>所得</td><td className="num">{yen(t.sideIncome)}</td></tr>
          </tbody>
        </table>
        <p className="muted small">収入の種類を「副業」にした収入と、「副業の経費」にチェックした支出から計算します。</p>
      </section>

      <section className="card">
        <h3>競馬（一時所得）</h3>
        <table className="table">
          <tbody>
            <tr><td>払戻の合計</td><td className="num">{yen(t.keibaPayout)}</td></tr>
            <tr><td>的中馬券の購入額</td><td className="num">-{yen(t.keibaHitCost)}</td></tr>
            <tr><td>特別控除</td><td className="num">-{yen(TEMPORARY_INCOME_DEDUCTION)}</td></tr>
            <tr><td>一時所得</td><td className="num">{yen(t.temporaryIncome)}</td></tr>
            <tr className="total"><td>課税対象（1/2）</td><td className="num">{yen(t.temporaryTaxable)}</td></tr>
          </tbody>
        </table>
        <p className="muted small">
          参考：年間の購入額合計 {yen(t.keibaPurchase)}。原則として経費にできるのは払戻を受けた馬券の購入額のみです。
          競馬の明細で「的中した馬券の購入額」を入力すると反映されます。
        </p>
      </section>

      <section className="card">
        <h3>計算の前提</h3>
        <div className="form">
          <label className="check">
            <input type="checkbox" checked={s.salaried} onChange={(e) => setTax({ salaried: e.target.checked })} />
            会社員など給与所得者（年末調整あり）
          </label>
          {s.salaried && (
            <>
              <label>
                本業の年収（額面）
                <div className="yen-input"><span>¥</span>
                  <input inputMode="numeric" value={s.salaryAnnual || ''} onChange={(e) => setTax({ salaryAnnual: Number(e.target.value.replace(/,/g, '')) || 0 })} />
                </div>
              </label>
              <label>
                社会保険料の割合（年収に対する概算）
                <div className="yen-input">
                  <input inputMode="decimal" value={Math.round(s.socialInsuranceRate * 1000) / 10} onChange={(e) => setTax({ socialInsuranceRate: (Number(e.target.value) || 0) / 100 })} />
                  <span>%</span>
                </div>
              </label>
            </>
          )}
          <label>
            その他の所得控除の合計（生命保険料控除・扶養控除など）
            <div className="yen-input"><span>¥</span>
              <input inputMode="numeric" value={s.otherDeductions || ''} onChange={(e) => setTax({ otherDeductions: Number(e.target.value.replace(/,/g, '')) || 0 })} />
            </div>
          </label>
        </div>
        <p className="muted small">
          ※ 本業の所得に副業・競馬の所得を上乗せしたときに増える税額を概算しています。給与所得者は給与以外の所得が年20万円以下なら所得税の確定申告は不要ですが、住民税の申告は必要です。
          住民税の均等割・各種の特例は含みません。正確な税額は税務署・税理士にご確認ください。
        </p>
      </section>
    </div>
  );
}
