const UPDATE = `UPDATE books
SET stock = stock - 1
WHERE id = 42
  AND stock >= 1;`;

const INSERT_ORDER = `INSERT INTO orders (book_id, qty)
VALUES (42, 1);`;

const NONE = `-- 이 단계에서는 SQL이 나가지 않습니다.
-- 화면 요청만 도착했거나, 자바 코드가 준비 중입니다.`;

export const queries = {
  "no-tx": [
    NONE,
    `-- 트랜잭션을 열지 않습니다.
-- 연결의 autocommit = true
-- 그래서 아래 UPDATE는 끝나는 즉시 확정됩니다.`,
    `${UPDATE}
-- 1 row
-- 즉시 확정: books.stock = 9`,
    `-- 결제 실패로 주문 INSERT는 실행하지 않습니다.

-- 남아 있는 결과
SELECT stock FROM books WHERE id = 42;  -- 9
SELECT COUNT(*) FROM orders;            -- 0`,
  ],
  commit: [
    NONE,
    `BEGIN;
-- autocommit을 끄고, 이후 문장을 한 묶음으로 둡니다.`,
    `${UPDATE}
-- 실행됨. 이 트랜잭션 안에서는 stock = 9
-- 아직 커밋 전이라 확정값은 10`,
    `${INSERT_ORDER}
-- 이 트랜잭션 안에서만 주문 1건
-- 밖에서는 아직 0건`,
    `COMMIT;
-- 확정: books.stock = 9
-- 확정: orders 1건`,
  ],
  rollback: [
    NONE,
    `BEGIN;`,
    `${UPDATE}
-- 임시로만 stock = 9`,
    `-- 결제 실패
-- COMMIT 하지 않음
-- INSERT INTO orders 는 실행하지 않음`,
    `ROLLBACK;
-- BEGIN 이후 변경을 버림
-- 확정: books.stock = 10
-- 확정: orders 0건`,
  ],
  "spring-ok": [
    NONE,
    `-- 컨트롤러는 SQL을 만들지 않습니다.
-- placeOrder() 호출만 합니다.`,
    `-- 아직 SQL 없음
-- 프록시가 트랜잭션을 열기 직전`,
    `-- 스프링이 개발자 대신 실행
SET autocommit = 0;
BEGIN;`,
    `${UPDATE}

${INSERT_ORDER}
-- 둘 다 같은 커넥션, 아직 커밋 전`,
    `COMMIT;
-- 확정: stock = 9, orders = 1`,
    `-- 추가 SQL 없음
-- 커넥션만 풀로 반환`,
  ],
  "spring-fail": [
    NONE,
    `SET autocommit = 0;
BEGIN;`,
    `${UPDATE}
-- 실행됨, 커밋 전`,
    `-- 예외가 나서 추가 SQL은 없습니다.
-- INSERT INTO orders 는 실행되지 않음`,
    `ROLLBACK;
-- stock 은 다시 10`,
    `-- 추가 SQL 없음
-- 커넥션만 풀로 반환
-- books.stock = 10, orders = 0`,
  ],
  "prop-required": [
    `BEGIN;`,
    `${UPDATE}
-- 트랜잭션 안에서만 stock = 9`,
    `-- 새 트랜잭션을 열지 않습니다.
-- 결제 INSERT도 위의 BEGIN 에 들어갑니다.
INSERT INTO payment_attempts (book_id, qty)
VALUES (42, 1);`,
    `-- SQL을 더 보내지 않습니다.
-- 참여 중인 트랜잭션에 실패를 표시`,
    `ROLLBACK;
-- 재고 UPDATE 와 결제 INSERT 가 함께 취소
-- stock = 10, payment_attempts = 0`,
  ],
  "prop-requires-new": [
    `-- 트랜잭션 A
BEGIN;`,
    `${UPDATE}
-- A 안, 아직 커밋 전`,
    `-- A는 잠시 멈춤
-- 트랜잭션 B를 새로 시작
BEGIN;`,
    `-- B만 커밋
INSERT INTO audit_log (book_id, action)
VALUES (42, '결제 시도');
COMMIT;`,
    `-- A만 롤백. B는 이미 커밋되어 남음
ROLLBACK;

SELECT COUNT(*) FROM audit_log;  -- 1
SELECT stock FROM books WHERE id = 42;  -- 10`,
  ],
  "prop-nested": [
    `BEGIN;`,
    `${UPDATE}
${INSERT_ORDER}
-- 바깥 트랜잭션, 아직 커밋 전`,
    `SAVEPOINT coupon_try;`,
    `INSERT INTO coupons (order_id, code)
VALUES (1001, 'WELCOME');
-- 중복으로 실패

ROLLBACK TO SAVEPOINT coupon_try;
-- 주문 INSERT 는 저장점 이전이라 유지`,
    `COMMIT;
-- stock = 9, orders = 1, coupons = 0`,
  ],
  "prop-not-supported": [
    `BEGIN;`,
    `${UPDATE}
-- 커넥션을 아직 잡고 있음`,
    `-- 트랜잭션을 잠시 멈추고 커넥션을 풀에 반환
-- 이 메서드 안에서는 SQL을 실행하지 않음`,
    `-- DB 문장 없음
-- 카드사 HTTP만 왕복`,
    `${INSERT_ORDER}
COMMIT;
-- stock = 9, orders = 1`,
  ],
  "prop-supports": [
    `-- 트랜잭션 없이
SELECT stock FROM books WHERE id = 42;
-- 결과 10`,
    `${UPDATE}
-- 주문 트랜잭션 안, 커밋 전`,
    `-- 같은 트랜잭션의 커넥션으로
SELECT stock FROM books WHERE id = 42;
-- 결과 9  (방금 깎은 임시 값)`,
    `-- 추가 SQL 없음
-- 판단에 쓴 값은 9`,
  ],
  "prop-mandatory": [
    `-- 메서드 선언만 있는 단계
-- 아직 SQL 없음`,
    `-- 호출자에 트랜잭션이 없음
-- SQL을 보내기 전`,
    `-- UPDATE 는 실행되지 않음
-- books.stock 은 10 그대로`,
  ],
  "prop-never": [
    `${UPDATE}
-- 주문 트랜잭션이 재고 행을 붙잡고 있음`,
    `-- 리포트 쿼리는 실행하지 않음
-- 트랜잭션이 있어서 거절`,
    `-- 주문 트랜잭션 밖에서만 실행
SELECT SUM(amount) FROM orders WHERE ordered_on = CURRENT_DATE;`,
  ],
  "ext-hang": [
    `POST /v1/charges
Idempotency-Key: order-1001
{ "orderId": 1001, "amount": 18000 }`,
    `POST /v1/charges
-- 전송됨. 승인 본문이 오지 않음
-- 타임아웃이 없으면 수신 대기가 계속됨`,
    `-- 우리 DB SQL 없음
-- 스레드가 카드사 응답에 묶여 있음`,
    `-- 상품 조회도 시작하지 못함
-- 일꾼이 카드사를 기다리느라 없음`,
  ],
  "ext-timeout": [
    `-- 아직 승인 요청 전
-- 카드사 연결 3초, 응답 5초`,
    `POST /v1/charges
Idempotency-Key: order-1001
{ "orderId": 1001, "amount": 18000 }
-- 5초 안에 승인 또는 거절이 와야 함`,
    `-- 5초 초과로 수신을 중단
-- 주문은 결제 완료가 아님`,
    `GET /books/42
-- 우리 DB만 사용. 카드사와 무관`,
  ],
  "ext-retry": [
    `POST /v1/charges
Idempotency-Key: order-1001
-- 1회차 응답: 503 잠시 후`,
    `-- 0.5초 대기. 아직 재전송 없음`,
    `POST /v1/charges
Idempotency-Key: order-1001
-- 2회차. 같은 키라 카드사는 새 결제로 받지 않음
-- 응답: 승인`,
    `-- 3회 모두 실패하면 추가 POST 없음
-- INSERT INTO orders 도 없음`,
  ],
  "ext-breaker": [
    `-- 최근 10건 집계
-- 아직 새 POST 없음`,
    `-- 회로 열림
-- POST /v1/charges 를 보내지 않음`,
    `POST /v1/charges
Idempotency-Key: order-1001
-- 시험 요청. 최대 3건`,
    `-- 시험 성공 시에만 승인 요청 재개
-- 실패 시 다시 전송 중단`,
  ],
  "ext-fallback": [
    `-- 회로 열림. POST /v1/charges 없음`,
    `-- SQL 없음
-- 결제 완료로 저장하지 않음
-- 화면: 잠시 후 다시 시도`,
    `GET /books
-- 200, 우리 DB
POST /orders/pay
-- 잠시 후 안내`,
    `POST /v1/charges
Idempotency-Key: order-1001
-- 카드사 복구 후 승인

BEGIN;
UPDATE books SET stock = stock - 1 WHERE id = 42 AND stock >= 1;
INSERT INTO orders (book_id, qty, paid) VALUES (42, 1, 1);
COMMIT;`,
  ],
  "ext-bulkhead": [
    `-- SQL 없음
-- 카드사 동시 호출 3, 우리 DB 연결 10`,
    `POST /v1/charges
Idempotency-Key: order-1001
-- 카드사 연결 3/3
-- 4번째 결제는 2초 후 연결 대여 실패`,
    `SELECT title, stock FROM books WHERE id = 42;
-- 우리 DB 풀. 카드사 연결과 무관`,
    `-- 추가 호출 없음
-- 카드 승인만 닫히고 상품 조회는 유지`,
  ],
};

export const compareScripts = [
  {
    id: "no-tx",
    title: "묶지 않으면",
    result: "재고 9, 주문 0",
    sql: `${UPDATE}
-- 여기서 바로 확정

-- 결제 실패. 아래는 실행하지 않음
-- INSERT INTO orders (book_id, qty)
-- VALUES (42, 1);`,
  },
  {
    id: "commit",
    title: "한 번에 저장",
    result: "재고 9, 주문 1",
    sql: `BEGIN;
${UPDATE}
${INSERT_ORDER}
COMMIT;`,
  },
  {
    id: "rollback",
    title: "전부 취소",
    result: "재고 10, 주문 0",
    sql: `BEGIN;
${UPDATE}
-- 결제 실패. INSERT 없음
ROLLBACK;`,
  },
];

export const compareFocus = {
  "no-tx": "no-tx",
  commit: "commit",
  rollback: "rollback",
  "spring-ok": "commit",
  "spring-fail": "rollback",
  "prop-required": "rollback",
  "prop-requires-new": "rollback",
  "prop-nested": "commit",
  "prop-not-supported": "commit",
  "prop-supports": "commit",
  "prop-mandatory": "no-tx",
  "prop-never": "commit",
};
