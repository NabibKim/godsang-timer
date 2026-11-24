# =====================================================================
# gt-auth : 회원가입 / 로그인 / 세션 발급 / 마이페이지 API (PHP 8.2 + Apache)
# =====================================================================
FROM php:8.2-apache

ENV TZ=Asia/Seoul

# 1) MySQL 접속용 PDO 확장 설치
# 2) Redis 접속용 phpredis 확장 설치 (세션 공유)
# 3) .htaccess 라우팅을 위해 mod_rewrite 활성화 + AllowOverride 허용
# 4) PHP 시간대를 한국 시간으로 설정
RUN docker-php-ext-install pdo pdo_mysql \
 && pecl install redis \
 && docker-php-ext-enable redis \
 && a2enmod rewrite \
 && sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf \
 && echo "date.timezone=Asia/Seoul" > /usr/local/etc/php/conf.d/timezone.ini

# 소스 코드를 이미지 안에 복사 (도커 허브 이미지만으로 실행 가능하게)
COPY . /var/www/html/

EXPOSE 80
