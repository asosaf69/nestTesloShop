import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PaginationDto } from 'src/common/dtos/pagination.dto';

import { Product, ProductImage } from './entities';
import { validate as isUUID } from 'uuid';

@Injectable()
export class ProductsService {

  private readonly logger = new Logger('ProductsService');

  constructor(

    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,

    @InjectRepository(ProductImage)
    private readonly productImageRepository: Repository<ProductImage>,

    private readonly dataSource: DataSource

  ) {}



  async create(createProductDto: CreateProductDto) {
    
    try {
      // excluyendo imagenes de las propiedades
      const { images = [], ...productDetails } = createProductDto;
      const product = this.productRepository.create({
        ...productDetails,
        images: images.map( image => this.productImageRepository.create({ url: image }) )
      });
      await this.productRepository.save( product );

      return { ...product, images };
      
    } catch (error) {
      this.handleDBExceptions(error);
    }


  }


  async findAll( paginationDto: PaginationDto ) {

    const { limit = 10, offset = 0 } = paginationDto;

    const products = await this.productRepository.find({
      take: limit,
      skip: offset,
      relations: {
        images: true,
      }
    })
    return products.map( product => ({
      ...product,
      images: product.images.map( img => img.url )
    }));
  }

  async findOne( term: string ) {

    let product: Product;

    if ( isUUID(term) ) {
      product = await this.productRepository.findOneBy({ id: term });
    } else {
      const queryBuilder = this.productRepository.createQueryBuilder(); 
      product = await queryBuilder
        .where('UPPER(title) =:title or slug =:slug', {
          title: term.toUpperCase(),
          slug: term.toLowerCase(),
        })
        .leftJoinAndSelect('Product.images', 'images')
        .getOne();
    }


    if ( !product ) 
      throw new NotFoundException(`Product with ${ term } not found`);

    return product;
  }

  async findOnePlain( term: string ) {
    const { images = [], ...prod } = await this.findOne(term);
    return {
      ...prod,
      images: images.map(image => image.url)
    }
  } 

  async update( id: string, updateProductDto: UpdateProductDto ) {

    const { images, ...toUpdate } = updateProductDto;

    const product = await this.productRepository.preload({ id, ...toUpdate });

    if ( !product ) throw new NotFoundException(`Product with id: ${ id } not found`);

    // create query runner 
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if ( images )  {
        // se van a borrar las imagenes viejas
        await queryRunner.manager.delete( ProductImage, { product: { id }})
        // se empiezan a mapear las imagenes nuevas para insertar 
        product.images = images.map(
          image => this.productImageRepository.create({ url: image })
        )
      } else {
        product.images = await this.productImageRepository.findBy({ product: { id } });
      }
    
      await queryRunner.manager.save( product );
      await queryRunner.commitTransaction();
      await queryRunner.release();
      return product;
      
    } catch (error) {
      console.log(error);
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
      this.handleDBExceptions(error);
    }

  }

  async remove(id: string) {
    const product = await this.findOne( id );
    await this.productRepository.remove( product );
    
  }

  async deleteAllProducts() {
    const query = this.productRepository.createQueryBuilder('product');
    try {
      return await query
        .delete()
        .where({})
        .execute();
    } catch (error) {
      this.handleDBExceptions(error);
    }
  }


  private handleDBExceptions( error: any ) {

    if ( error.code === '23505' )
      throw new BadRequestException(error.detail);
    
    this.logger.error(error)
    // console.log(error)
    throw new InternalServerErrorException('Unexpected error, check server logs');

  }

}
